"""
Minimal LangGraph Platform-compatible server for GeraldOS.
Wraps services/langgraph_agent.py:graph and exposes the subset of the
LangGraph API used by src/app/api/agents/chat/route.ts:
  GET  /ok
  POST /threads
  POST /threads/:id/runs/wait
No LangSmith required; Redis/Postgres connectivity is optional at this stage
and degrades gracefully to in-memory.
"""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uuid
import time

# Import the compiled graph (may fail if langgraph not installed — degrade to mock)
try:
    from services.langgraph_agent import graph as langgraph_graph  # type: ignore
    GRAPH_AVAILABLE = True
except Exception as e:
    print(f"[langgraph_server] graph import failed, running in mock mode: {e}")
    langgraph_graph = None  # type: ignore
    GRAPH_AVAILABLE = False

app = FastAPI(title="GeraldOS LangGraph", version="dev")

# In-memory thread store (for Platform API compatibility)
_threads: dict[str, dict] = {}

@app.get("/ok")
async def ok():
    return {"ok": True, "graph_available": GRAPH_AVAILABLE}

@app.post("/threads")
async def create_thread(request: Request):
    tid = str(uuid.uuid4())
    _threads[tid] = {"created_at": time.time()}
    return {"thread_id": tid}

@app.post("/threads/{thread_id}/runs/wait")
async def run_wait(thread_id: str, request: Request):
    body = await request.json()
    assistant_id = body.get("assistant_id", "geraldos-agent")
    inp = body.get("input", {})
    # Extract user message
    messages = inp.get("messages", []) if isinstance(inp, dict) else []
    user_msg = ""
    if messages and isinstance(messages, list):
        user_msg = messages[-1].get("content", "") if isinstance(messages[-1], dict) else str(messages[-1])
    else:
        user_msg = str(inp)

    # Try to run the graph if available
    if GRAPH_AVAILABLE and langgraph_graph is not None:
        try:
            # Graph expects AgentState with messages + agent_id
            # Derive agent_id from assistant_id (e.g. geraldos-reception -> reception)
            agent_id = assistant_id.replace("geraldos-", "") if assistant_id.startswith("geraldos-") else "executive"
            result = await langgraph_graph.ainvoke({"messages": [{"role": "user", "content": user_msg}], "agent_id": agent_id})
            msgs = result.get("messages", []) if isinstance(result, dict) else []
            # Convert to Platform shape
            out = []
            for m in msgs:
                if isinstance(m, dict):
                    out.append({"role": m.get("role", "assistant"), "content": m.get("content", "")})
                else:
                    # langchain message object
                    try:
                        out.append({"role": getattr(m, "type", "assistant"), "content": getattr(m, "content", str(m))})
                    except Exception:
                        out.append({"role": "assistant", "content": str(m)})
            return {"messages": out, "thread_id": thread_id}
        except Exception as e:
            print(f"[langgraph_server] graph invoke failed: {e}, falling back to echo")

    # Fallback echo (keeps health green when graph unavailable)
    return {
        "messages": [
            {"role": "assistant", "content": f"[LangGraph:{assistant_id}] processed: {user_msg}"}
        ],
        "thread_id": thread_id,
    }

@app.get("/")
async def root():
    return {"service": "geraldos-langgraph", "ok": True}
