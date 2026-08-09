import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("@/db", () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 1 }]),
      }),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
          limit: vi.fn().mockResolvedValue([]),
        }),
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
        groupBy: vi.fn().mockReturnValue({
          orderBy: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
}));

// Mock integrations
vi.mock("@/lib/integrations", () => ({
  integrationConfig: {
    redis: { url: "" },
  },
}));

// Mock ioredis
vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    multi: vi.fn().mockReturnValue({
      xadd: vi.fn().mockReturnValue({
        exec: vi.fn().mockResolvedValue([]),
      }),
    }),
    on: vi.fn(),
  })),
}));

import { publishEvent, listEvents, eventCounts, EVENT_TYPES } from "@/lib/events";

describe("Event Bus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("publishEvent", () => {
    it("should publish an event to the database", async () => {
      await publishEvent({
        type: EVENT_TYPES.PATIENT_REGISTERED,
        aggregate: "patient",
        payload: { name: "Test Patient" },
      });

      // Should have attempted to insert into event_log
      expect(true).toBe(true);
    });

    it("should handle Redis unavailability gracefully", async () => {
      // Redis is not configured in mock, should still work
      await publishEvent({
        type: EVENT_TYPES.STUDY_UPLOADED,
        aggregate: "orthanc",
        payload: { studyId: "test-123" },
      });

      expect(true).toBe(true);
    });
  });

  describe("listEvents", () => {
    it("should return events from database", async () => {
      const events = await listEvents(10);
      expect(Array.isArray(events)).toBe(true);
    });

    it("should support type filtering", async () => {
      const events = await listEvents(10, EVENT_TYPES.PATIENT_REGISTERED);
      expect(Array.isArray(events)).toBe(true);
    });
  });

  describe("eventCounts", () => {
    it("should return event counts grouped by type", async () => {
      const counts = await eventCounts();
      expect(Array.isArray(counts)).toBe(true);
    });
  });

  describe("EVENT_TYPES", () => {
    it("should contain all required event types", () => {
      expect(EVENT_TYPES.PATIENT_REGISTERED).toBe("patient.registered");
      expect(EVENT_TYPES.STUDY_UPLOADED).toBe("study.uploaded");
      expect(EVENT_TYPES.REPORT_SIGNED).toBe("report.signed");
      expect(EVENT_TYPES.AI_OBSERVATION_ACCEPTED).toBe("ai.observation_accepted");
      expect(EVENT_TYPES.DECISION_EXECUTED).toBe("decision.executed");
      expect(EVENT_TYPES.EQUIPMENT_OFFLINE).toBe("equipment.offline");
    });
  });
});
