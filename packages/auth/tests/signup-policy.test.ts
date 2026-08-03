import assert from "node:assert/strict";
import test from "node:test";

import { signupPolicy } from "../signup-policy";

test("production signup is fail-closed to the launch waitlist policy", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousPolicy = process.env.AUTH_SIGNUP_POLICY;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.AUTH_SIGNUP_POLICY;
    assert.equal(signupPolicy(), "waitlist");

    process.env.AUTH_SIGNUP_POLICY = "open";
    assert.throws(signupPolicy, /Open signup is not approved for production/);

    process.env.AUTH_SIGNUP_POLICY = "unreviewed";
    assert.throws(() => signupPolicy(), /must be either 'open' or 'waitlist'/);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousPolicy === undefined) delete process.env.AUTH_SIGNUP_POLICY;
    else process.env.AUTH_SIGNUP_POLICY = previousPolicy;
  }
});

test("local development can explicitly exercise the open-signup flow", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousPolicy = process.env.AUTH_SIGNUP_POLICY;
  try {
    process.env.NODE_ENV = "development";
    process.env.AUTH_SIGNUP_POLICY = "open";
    assert.equal(signupPolicy(), "open");
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousPolicy === undefined) delete process.env.AUTH_SIGNUP_POLICY;
    else process.env.AUTH_SIGNUP_POLICY = previousPolicy;
  }
});
