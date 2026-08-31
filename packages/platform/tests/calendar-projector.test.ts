import assert from "node:assert/strict";
import test from "node:test";
import { isMissingCalendarOrganizationError } from "../calendar/projector";

test("calendar projector recognizes only its terminal missing-organization foreign key", () => {
  assert.equal(isMissingCalendarOrganizationError({
    cause: {
      code: "23503",
      constraint: "calendar_entries_organization_fk",
    },
  }), true);

  assert.equal(isMissingCalendarOrganizationError({
    code: "23503",
    constraint: "some_other_foreign_key",
  }), false);
  assert.equal(isMissingCalendarOrganizationError({
    cause: { code: "40001", constraint: "calendar_entries_organization_fk" },
  }), false);
  assert.equal(isMissingCalendarOrganizationError(new Error("database unavailable")), false);
});
