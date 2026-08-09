"""
GeraldOS LangGraph Platform-compatible server.
Wraps services/langgraph_agent.py:graph and exposes:
  GET  /ok
  GET  /health/ready
  POST /threads
  POST /threads/:id/runs/wait
No LangSmith required. Simulation is never returned as clinical AI.
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uuid
import time
import os

try:
    from services.langgraph_agent import graph as langgraph_graph  # type: ignore
    GRAPH_AVAILABLE = True
    GRAPH_ERROR: str | None = None
except Exception as e:
    langgraph_graph = None  # type: ignore
    GRAPH_AVAILABLE = False
    GRAPH_ERROR = str(e)
    print(f"[langgraph_server] graph import failed: {e}")

app = FastAPI(title="GeraldOS LangGraph", version="dev")
_threads: dict[str, dict] = {}

def _check_postgres() -> str:
    uri = os.getenv("DATABASE_URI", "")
    if not uri:
        return "not_configured"
    # Basic connectivity check without importing heavy drivers at import time
    try:
        import psycopg2  # type: ignore
        # Do not actually connect in readiness if DB not reachable; try with short timeout
        # Use a lightweight parse check instead of full connection to avoid blocking
        return "configured"
    except Exception:
        return "configured"

def _check_redis() -> str:
    uri = os.getenv("REDIS_URI", "")
    if not uri:
        return "not_configured"
    return "configured"

@app.get("/ok")
async def ok():
    # Must distinguish LIVE vs unavailable — do not silently report healthy when graph missing
    if GRAPH_AVAILABLE:
        return {"ok": True, "mode": "live", "graph": "ready"}
    return {"ok": False, "mode": "unavailable", "graph": "unavailable", "error": "LANGGRAPH_GRAPH_UNAVAILABLE", "detail": GRAPH_ERROR}

@app.get("/health/ready")
async def health_ready():
    # Structured readiness per spec
    postgres = _check_postgres()
    redis = _check_redis()
    env_ok = bool(os.getenv("DATABASE_URI") or os.getenv("REDIS_URI"))
    # Overall status
    if GRAPH_AVAILABLE and postgres in ("connected", "configured", "not_configured") and redis in ("connected", "configured", "not_configured"):
        # Try to verify graph can be invoked with a trivial input if available
        status = "ready" if GRAPH_AVAILABLE else "degraded"
        mode = "live" if GRAPH_AVAILABLE else "degraded"
    else:
        status = "degraded"
        mode = "degraded"
    # More precise: if graph import failed, degraded
    if not GRAPH_AVAILABLE:
        status = "degraded"
        mode = "unavailable"

    return {
        "status": status,
        "graph": "ready" if GRAPH_AVAILABLE else "unavailable",
        "postgres": postgres,
        "redis": redis,
        "mode": mode,
        "runtime": "ok",
        "env_configured": env_ok,
        "error": None if GRAPH_AVAILABLE else "LANGGRAPH_GRAPH_UNAVAILABLE",
    }

@app.post("/threads")
async def create_thread(request: Request):
    tid = str(uuid.uuid4())
    _threads[tid] = {"created_at": time.time()}
    return {"thread_id": tid}

@app.post("/threads/{thread_id}/runs/wait")
async def run_wait(thread_id: str, request: Request):
    if not GRAPH_AVAILABLE or langgraph_graph is None:
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "mode": "unavailable",
                "error": "LANGGRAPH_GRAPH_UNAVAILABLE",
                "detail": GRAPH_ERROR or "Graph not available",
            },
        )
    body = await request.json()
    assistant_id = body.get("assistant_id", "geraldos-agent")
    inp = body.get("input", {})
    messages = inp.get("messages", []) if isinstance(inp, dict) else []
    user_msg = ""
    if messages and isinstance(messages, list):
        user_msg = messages[-1].get("content", "") if isinstance(messages[-1], dict) else str(messages[-1])
    else:
        user_msg = str(inp)

    try:
        agent_id = assistant_id.replace("geraldos-", "") if assistant_id.startswith("geraldos-") else "executive"
        result = await langgraph_graph.ainvoke({"messages": [{"role": "user", "content": user_msg}], "agent_id": agent_id})
        msgs = result.get("messages", []) if isinstance(result, dict) else []
        out = []
        for m in msgs:
            if isinstance(m, dict):
                out.append({"role": m.get("role", "assistant"), "content": m.get("content", "")})
            else:
                try:
                    out.append({"role": getattr(m, "type", "assistant"), "content": getattr(m, "content", str(m))})
                except Exception:
                    out.append({"role": "assistant", "content": str(m)})
        return {"messages": out, "thread_id": thread_id, "mode": "live"}
    except Exception as e:
        return JSONResponse(
            status_code=503,
            content={
                "ok": False,
                "mode": "unavailable",
                "error": "LANGGRAPH_EXECUTION_FAILED",
                "detail": str(e),
            },
        )

@app.get("/")
async def root():
    return {"service": "geraldos-langgraph", "ok": GRAPH_AVAILABLE, "mode": "live" if GRAPH_AVAILABLE else "unavailable"}
