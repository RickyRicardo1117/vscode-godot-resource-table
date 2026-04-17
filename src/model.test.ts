import { describe, expect, it } from "vitest";
import { orderPropertyKeysFromFileOrders } from "./model";

describe("orderPropertyKeysFromFileOrders", () => {
  it("keeps parse order from a single resource", () => {
    expect(orderPropertyKeysFromFileOrders([["z", "a", "m"]])).toEqual(["z", "a", "m"]);
  });

  it("keeps adjacent dev fields like in .tres (phase before notes)", () => {
    expect(
      orderPropertyKeysFromFileOrders([
        ["internal_development_phase", "internal_dev_notes"],
      ])
    ).toEqual(["internal_development_phase", "internal_dev_notes"]);
  });

  it("chains extra keys after shared prefix (base + extension files)", () => {
    expect(
      orderPropertyKeysFromFileOrders([
        ["id", "name"],
        ["id", "name", "tier"],
      ])
    ).toEqual(["id", "name", "tier"]);
  });

  it("uses first-seen to break conflicting order between files", () => {
    expect(
      orderPropertyKeysFromFileOrders([
        ["name", "id"],
        ["id", "name", "tier"],
      ])
    ).toEqual(["name", "id", "tier"]);
  });

  it("orders keys only in later files after their predecessors when possible", () => {
    const got = orderPropertyKeysFromFileOrders([
      ["b", "shared"],
      ["a", "shared"],
    ]);
    expect(got).toEqual(["b", "a", "shared"]);
  });
});
