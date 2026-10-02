import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

let mounts = 0;

function Form() {
  const [value, setValue] = React.useState("");
  React.useEffect(() => {
    mounts += 1;
  }, []);
  return <input aria-label="Name" value={value} onChange={(e) => setValue(e.target.value)} />;
}

function Harness({ open }: { open: boolean }) {
  return (
    <Dialog open={open}>
      <DialogContent>
        <DialogTitle>Title</DialogTitle>
        <DialogDescription>Text</DialogDescription>
        <Form />
      </DialogContent>
    </Dialog>
  );
}

/**
 * The real dialogs fade out (a CSS animation per state), and stay in the page until the animation ends. jsdom has no animations,
 * so the lookup that the dialog library does to find out whether there is one says: a different animation when closed.
 * `animationend` never comes, so a closed dialog stays - like in the browser, a moment after it was closed.
 */
function fakeExitAnimation() {
  const real = window.getComputedStyle.bind(window);
  return vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element, pseudo?: string | null) => {
    const style = real(element, pseudo);
    if (!element.getAttribute("data-state")) return style;
    return new Proxy(style, {
      get(target, prop) {
        if (prop === "animationName") return element.getAttribute("data-state") === "closed" ? "fade-out" : "fade-in";
        const value = Reflect.get(target, prop);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });
}

describe("Dialog", () => {
  beforeEach(() => {
    mounts = 0;
  });
  afterEach(() => vi.restoreAllMocks());

  it("is a new instance each time it opens, also while the previous one is still fading out", () => {
    fakeExitAnimation();
    const { rerender } = render(<Harness open />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "typed last time" } });

    rerender(<Harness open={false} />);
    // fading out: still in the page - the situation of a quick second click on the button that opens it
    expect(screen.queryByLabelText("Name")).not.toBeNull();

    rerender(<Harness open />);
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(mounts).toBe(2);
  });

  it("starts empty after a normal close and re-open as well", () => {
    const { rerender } = render(<Harness open />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "abc" } });
    rerender(<Harness open={false} />);
    expect(screen.queryByLabelText("Name")).toBeNull();
    rerender(<Harness open />);
    expect(screen.getByLabelText("Name")).toHaveValue("");
    expect(mounts).toBe(2);
  });

  it("does not rebuild the content while it stays open", () => {
    const { rerender } = render(<Harness open />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "keep me" } });
    rerender(<Harness open />);
    expect(screen.getByLabelText("Name")).toHaveValue("keep me");
    expect(mounts).toBe(1);
  });
});
