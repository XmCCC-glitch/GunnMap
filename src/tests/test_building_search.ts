import assert from "node:assert/strict";
import { test } from "node:test";
import { buildingData } from "../project.js";
import { buildingCenter, findBuilding } from "../../web/src/features/rooms/building-search.js";

test("building search recognizes codes and names without claiming the library as a whole building", () => {
  const regions = buildingData.regions;
  assert.deepEqual(buildingData.image_size, [2448, 1584]);
  for (const [code, region] of Object.entries(regions)) {
    assert.ok(region.polygons.length > 0, `${code} needs a visible area`);
    for (const polygon of region.polygons) {
      assert.ok(polygon.length >= 3, `${code} needs a polygon`);
      for (const [x, y] of polygon) {
        assert.ok(x >= 0 && x <= 2448 && y >= 0 && y <= 1584, `${code} extends beyond the map`);
      }
    }
  }
  assert.equal(findBuilding(regions, "N bldg"), "N");
  assert.equal(findBuilding(regions, "Bow Gym"), "BG");
  assert.equal(findBuilding(regions, "library"), null);
  assert.equal(findBuilding(regions, "N214"), null);
  const [x, y] = buildingCenter(regions.N.polygons);
  assert.ok(x > 0 && x < buildingData.image_size[0]);
  assert.ok(y > 0 && y < buildingData.image_size[1]);
});
