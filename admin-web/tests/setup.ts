import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// without `globals`, Testing Library does not remove rendered components between tests by itself
afterEach(() => cleanup());
