import assert from "node:assert/strict";
import test from "node:test";
import { validateGraph, graphDocumentSchema } from "../domain/graph";
import { FUNNEL_TEMPLATES, blankTemplate } from "../domain/templates";

test("template keys are unique and every template is presentable", () => {
  const keys = FUNNEL_TEMPLATES.map((template) => template.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const template of FUNNEL_TEMPLATES) {
    assert.ok(template.name.trim().length > 0);
    assert.ok(template.description.trim().length > 0);
    assert.ok(template.stepSummary.length > 0);
  }
});

test("the blank template seeds no graph", () => {
  assert.equal(blankTemplate.build, null);
  assert.ok(FUNNEL_TEMPLATES.some((template) => template.key === blankTemplate.key));
});

const seeded = FUNNEL_TEMPLATES.filter((template) => template.build !== null);

test("at least two templates seed a starter graph", () => {
  assert.ok(seeded.length >= 2);
});

for (const template of seeded) {
  test(`"${template.name}" builds a publishable graph`, () => {
    const graph = template.build!();
    assert.deepEqual(validateGraph(graph), []);
  });

  test(`"${template.name}" builds a schema-valid document`, () => {
    const graph = graphDocumentSchema.parse(template.build!());
    assert.ok(graph.entryNodeId);
    for (const node of graph.nodes) {
      assert.ok(node.name.trim().length > 0, `node ${node.id} has no name`);
      assert.ok(graph.layout[node.id], `node ${node.id} has no canvas position`);
    }
  });

  test(`"${template.name}" mints fresh ids on every build`, () => {
    const first = template.build!();
    const second = template.build!();
    const firstIds = new Set(first.nodes.map((node) => node.id));
    for (const node of second.nodes) {
      assert.equal(firstIds.has(node.id), false, "node id reused across builds");
    }
  });

  test(`"${template.name}" lays its steps out without overlap`, () => {
    // Rendered nodes are at most ~300px wide and ~150px tall; template
    // coordinates must keep every pair of bounding boxes clear of each other.
    const NODE_WIDTH = 300;
    const NODE_HEIGHT = 150;
    const graph = template.build!();
    const boxes = graph.nodes.map((node) => ({ name: node.name, ...graph.layout[node.id]! }));
    for (let a = 0; a < boxes.length; a += 1) {
      for (let b = a + 1; b < boxes.length; b += 1) {
        const overlapX = Math.abs(boxes[a].x - boxes[b].x) < NODE_WIDTH;
        const overlapY = Math.abs(boxes[a].y - boxes[b].y) < NODE_HEIGHT;
        assert.equal(
          overlapX && overlapY,
          false,
          `"${boxes[a].name}" and "${boxes[b].name}" overlap in the ${template.key} layout`,
        );
      }
    }
  });

  test(`"${template.name}" step summary matches its touch steps`, () => {
    const graph = template.build!();
    for (const step of template.stepSummary) {
      assert.ok(
        graph.nodes.some((node) => node.name === step),
        `summary step "${step}" is not a node in the graph`,
      );
    }
  });
}
