"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";

/**
 * The Radix dialog with one difference: every time it is opened it is a new instance.
 *
 * A dialog that is fading out is still mounted, and its layer still watches the page for clicks "outside" of it. A click on the
 * button that opens the same dialog again, a moment after it was closed, counts as such a click and closes it again at once - and
 * the form inside would still hold what was typed the last time. A new instance has no such history: it starts empty and it
 * ignores the click that opened it.
 */
export function DialogRoot(props: DialogPrimitive.DialogProps) {
  const open = !!props.open;
  const [state, setState] = React.useState({ open, generation: 0 });
  // (state derived while rendering: React runs this component again straight away, before anything is drawn)
  if (open !== state.open) setState({ open, generation: state.generation + (open ? 1 : 0) });
  return <DialogPrimitive.Root key={state.generation} {...props} />;
}
