import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Sheet } from "@/components/Sheet";

function Harness({ tick, onClose, onBlur }: { tick: number; onClose: () => void; onBlur?: () => void }) {
  const [open, setOpen] = useState(false);
  // a new onClose function on every render, like a page that writes `onClose={() => setOpen(false)}`
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Add note {tick}
      </button>
      <Sheet
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
        title="Add a note"
      >
        <textarea aria-label="note" onBlur={onBlur} />
        <button type="button">Save</button>
      </Sheet>
    </>
  );
}

describe("sheet", () => {
  it("puts the cursor in the text box and keeps it there while the page behind refreshes", async () => {
    const user = userEvent.setup();
    const blur = vi.fn();
    const { rerender } = render(<Harness tick={1} onClose={() => undefined} onBlur={blur} />);
    await user.click(screen.getByRole("button", { name: /Add note/ }));
    const box = screen.getByLabelText("note");
    expect(box).toHaveFocus();
    await user.type(box, "hello");

    // the page re-renders because its data refreshed: a new onClose each time
    rerender(<Harness tick={2} onClose={() => undefined} onBlur={blur} />);
    rerender(<Harness tick={3} onClose={() => undefined} onBlur={blur} />);
    expect(screen.getByLabelText("note")).toHaveFocus();
    expect(screen.getByLabelText("note")).toHaveValue("hello");
    expect(blur).not.toHaveBeenCalled(); // the focus was never taken away and given back
  });

  it("gives the focus back to the button that opened it", async () => {
    const user = userEvent.setup();
    render(<Harness tick={1} onClose={() => undefined} />);
    const opener = screen.getByRole("button", { name: /Add note/ });
    await user.click(opener);
    expect(screen.getByLabelText("note")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(opener).toHaveFocus();
  });

  it("closes with Escape, with the X and by pressing outside", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Harness tick={1} onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: /Add note/ }));
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: /Add note/ }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole("button", { name: /Add note/ }));
    const backdrop = screen.getByRole("dialog").parentElement as HTMLElement;
    await user.pointer({ target: backdrop, keys: "[MouseLeft]" });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("keeps Tab inside the sheet and locks the page behind it", async () => {
    const user = userEvent.setup();
    render(<Harness tick={1} onClose={() => undefined} />);
    await user.click(screen.getByRole("button", { name: /Add note/ }));
    expect(document.body.style.overflow).toBe("hidden");
    screen.getByRole("button", { name: "Save" }).focus();
    await user.tab(); // past the last control: back to the first one in the sheet
    expect(screen.getByRole("button", { name: "Close" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(document.body.style.overflow).toBe("");
  });
});
