import assert from 'node:assert/strict';
import test from 'node:test';
import { runWorkDeclarationMutation } from '../services/work-declaration.service';

test('work declaration mutations fall back only when standalone Mongo rejects transactions', async () => {
  const mongooseRuntime = require('mongoose');
  const originalStartSession = mongooseRuntime.startSession;
  let ended = false;
  let fallbackSession: unknown = 'not-called';
  mongooseRuntime.startSession = async () => ({
    withTransaction: async () => { throw new Error('Transaction numbers are only allowed on a replica set member or mongos'); },
    endSession: async () => { ended = true; },
  });

  try {
    const result = await runWorkDeclarationMutation(async (session) => {
      fallbackSession = session;
      return 'saved-without-transaction';
    });
    assert.equal(result, 'saved-without-transaction');
    assert.equal(fallbackSession, null);
    assert.equal(ended, true);
  } finally {
    mongooseRuntime.startSession = originalStartSession;
  }
});

test('work declaration mutations do not mask non-transaction errors', async () => {
  const mongooseRuntime = require('mongoose');
  const originalStartSession = mongooseRuntime.startSession;
  mongooseRuntime.startSession = async () => ({
    withTransaction: async () => { throw new Error('database connection lost'); },
    endSession: async () => {},
  });

  try {
    await assert.rejects(
      () => runWorkDeclarationMutation(async () => 'should-not-run'),
      /database connection lost/,
    );
  } finally {
    mongooseRuntime.startSession = originalStartSession;
  }
});
