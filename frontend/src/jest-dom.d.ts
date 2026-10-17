import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

// jest-dom declares `Assertion<T>` with one type parameter, and vitest 5 declares it with two, so
// TypeScript drops jest-dom's own augmentation and `expect(el).toBeInTheDocument()` stops type-checking.
declare module "vitest" {
  interface Assertion<R, T> extends TestingLibraryMatchers<unknown, R> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<unknown, unknown> {}
}
