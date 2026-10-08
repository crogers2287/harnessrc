import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { MockHarness } from './mock.ts';
test('mock bootstrap and agent responses match the installed Herdr 0.8.0 protocol-19 schema', () => {
  const schema = JSON.parse(
    readFileSync(new URL('../fixtures/herdr-0.8.0.schema.json', import.meta.url), 'utf8'),
  );
  const ajv = new (Ajv2020 as any)({ strict: false, validateFormats: false });
  (addFormats as any)(ajv);
  ajv.addSchema({ ...schema, $id: 'herdr-installed' });
  const validate = ajv.compile({ $ref: 'herdr-installed#/schemas/success_response' });
  const mock = new MockHarness();
  for (const method of ['session.snapshot', 'agent.get', 'pane.process_info']) {
    const response = {
      id: 'contract',
      result: mock.herdr({ method, params: { target: mock.paneId } }),
    };
    assert.ok(validate(response), JSON.stringify(validate.errors));
  }
  assert.equal(schema.protocol, 19);
});
