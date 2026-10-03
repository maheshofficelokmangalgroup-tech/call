"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { BookUser, UserPen } from "lucide-react";
import * as React from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { errorMessage } from "@/lib/api";
import { useCampaigns, useContactMutations, useEmployeeList } from "@/lib/queries";
import { CONTACT_STATUS, PRIORITY_LABEL } from "@/lib/status";
import type { ContactDetail } from "@/lib/types";
import { parseNumberList } from "@/lib/utils";

const schema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(255),
  phone: z.string().trim().min(3, "Enter the phone number.").max(32, "That number is too long."),
  more: z.string().max(1000),
  relative_name: z.string().trim().max(255),
  age: z.string().trim().refine((v) => v === "" || (/^\d{1,3}$/.test(v) && Number(v) <= 150), "Enter an age between 1 and 150."),
  gender: z.string(),
  epic_no: z.string().trim().max(32),
  pincode: z.string().trim().max(10),
  address: z.string().trim().max(2000),
  email: z.string().trim().max(255).refine((v) => v === "" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), "Enter a valid email address."),
  location: z.string().trim().max(255),
  category: z.string().trim().max(100),
  priority: z.string(),
  status: z.string(),
  tags: z.string().trim().max(500),
  employee: z.string(),
  campaign: z.string(),
});
type Values = z.infer<typeof schema>;

const blank: Values = { name: "", phone: "", more: "", relative_name: "", age: "", gender: "none", epic_no: "", pincode: "", address: "", email: "", location: "", category: "", priority: "2", status: "new", tags: "", employee: "none", campaign: "none" };

const parseTags = (text: string) => text.split(/[,;\n]/).map((t) => t.trim()).filter(Boolean).slice(0, 20);

/** Add a contact by hand, or edit one. When adding, the contact can be given to an employee and a campaign straight away. */
export function ContactFormDialog({ open, onOpenChange, contact }: { open: boolean; onOpenChange: (open: boolean) => void; contact?: ContactDetail | null }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <ContactFormBody contact={contact} onOpenChange={onOpenChange} />
      </DialogContent>
    </Dialog>
  );
}

/** Mounted only while the dialog is open, so it always starts from the contact (or from empty fields). */
function ContactFormBody({ contact, onOpenChange }: { contact?: ContactDetail | null; onOpenChange: (open: boolean) => void }) {
  const editing = !!contact;
  const { create, update } = useContactMutations();
  const employees = useEmployeeList({ isActive: true, role: "employee" });
  const campaigns = useCampaigns();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: contact
      ? {
          name: contact.name,
          phone: contact.phones[0]?.phone_raw || contact.phone_raw || contact.phone,
          more: contact.phones.slice(1).map((p) => p.phone_raw || p.phone).join("\n"),
          relative_name: contact.relative_name ?? "",
          age: contact.age ? String(contact.age) : "",
          gender: contact.gender ?? "none",
          epic_no: contact.epic_no ?? "",
          pincode: contact.pincode ?? "",
          address: contact.address ?? "",
          email: contact.email ?? "",
          location: contact.location ?? "",
          category: contact.category ?? "",
          priority: String(contact.priority),
          status: contact.status,
          tags: (contact.tags ?? []).join(", "),
          employee: "none",
          campaign: "none",
        }
      : blank,
  });
  const [error, setError] = React.useState<string | null>(null);

  async function submit(v: Values) {
    setError(null);
    try {
      if (contact) {
        await update.mutateAsync({
          id: contact.id,
          name: v.name,
          phones: [v.phone, ...parseNumberList(v.more)],  // every number of the person, the main one first
          relative_name: v.relative_name || null,
          age: v.age ? Number(v.age) : null,
          gender: v.gender === "none" ? null : (v.gender as "M" | "F" | "O"),
          epic_no: v.epic_no || null,
          pincode: v.pincode || null,
          address: v.address || null,
          email: v.email || null,
          location: v.location || null,
          category: v.category || null,
          priority: Number(v.priority),
          status: v.status as never,
          tags: parseTags(v.tags),
        });
        toast.success("Contact saved", { description: v.name });
      } else {
        await create.mutateAsync({
          name: v.name,
          phone: v.phone,
          more_phones: parseNumberList(v.more),
          relative_name: v.relative_name || null,
          age: v.age ? Number(v.age) : null,
          gender: v.gender === "none" ? null : (v.gender as "M" | "F" | "O"),
          epic_no: v.epic_no || null,
          pincode: v.pincode || null,
          address: v.address || null,
          email: v.email || null,
          location: v.location || null,
          category: v.category || null,
          priority: Number(v.priority),
          tags: parseTags(v.tags),
          assign_to_employee_id: v.employee === "none" ? null : Number(v.employee),
          campaign_id: v.campaign === "none" ? null : Number(v.campaign),
        });
        toast.success("Contact added", { description: v.name });
      }
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  const { errors, isSubmitting } = form.formState;
  return (
    <>
      <form onSubmit={form.handleSubmit(submit)} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-brand-soft text-brand">{editing ? <UserPen className="size-6" /> : <BookUser className="size-6" />}</div>
            <DialogTitle>{editing ? "Edit contact" : "New contact"}</DialogTitle>
            <DialogDescription>{editing ? "Change what the employees see when they call this person." : "A person your employees will call. For many at once, use Import sheet."}</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Name" htmlFor="cf-name" required error={errors.name?.message}>
                <Input id="cf-name" autoFocus aria-invalid={!!errors.name} {...form.register("name")} data-testid="contact-name" />
              </Field>
              <Field label="Phone number" htmlFor="cf-phone" required error={errors.phone?.message} hint="With or without +91; spaces are fine.">
                <Input id="cf-phone" type="tel" aria-invalid={!!errors.phone} {...form.register("phone")} data-testid="contact-phone" />
              </Field>
              <Field label="Other numbers of this person" htmlFor="cf-more" error={errors.more?.message} hint="One on each line. A number can belong to one person only." className="sm:col-span-2">
                <Textarea id="cf-more" rows={3} placeholder={"98 7654 3211\n98 7654 3212"} {...form.register("more")} data-testid="contact-more-phones" />
              </Field>
              <Field label="Relative's name" htmlFor="cf-relative" hint="Father, husband or guardian.">
                <Input id="cf-relative" {...form.register("relative_name")} />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Age" htmlFor="cf-age" error={errors.age?.message}>
                  <Input id="cf-age" inputMode="numeric" aria-invalid={!!errors.age} {...form.register("age")} />
                </Field>
                <Field label="Gender" htmlFor="cf-gender">
                  <Controller
                    control={form.control}
                    name="gender"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="cf-gender">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not said</SelectItem>
                          <SelectItem value="M">Male</SelectItem>
                          <SelectItem value="F">Female</SelectItem>
                          <SelectItem value="O">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </div>
              <Field label="Voter card number (EPIC)" htmlFor="cf-epic">
                <Input id="cf-epic" {...form.register("epic_no")} />
              </Field>
              <Field label="Pincode" htmlFor="cf-pincode">
                <Input id="cf-pincode" inputMode="numeric" {...form.register("pincode")} />
              </Field>
              <Field label="Address" htmlFor="cf-address" className="sm:col-span-2">
                <Textarea id="cf-address" rows={2} {...form.register("address")} />
              </Field>
              <Field label="Email" htmlFor="cf-email" error={errors.email?.message}>
                <Input id="cf-email" type="email" aria-invalid={!!errors.email} {...form.register("email")} />
              </Field>
              <Field label="City / location" htmlFor="cf-location">
                <Input id="cf-location" {...form.register("location")} />
              </Field>
              <Field label="Category" htmlFor="cf-category" hint="e.g. Retail, Distributor">
                <Input id="cf-category" {...form.register("category")} />
              </Field>
              <Field label="Priority" htmlFor="cf-priority" hint="High priority contacts come first in the employee's list.">
                <Controller
                  control={form.control}
                  name="priority"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="cf-priority">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[1, 2, 3].map((p) => (
                          <SelectItem key={p} value={String(p)}>
                            {PRIORITY_LABEL[p]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
              {editing ? (
                <Field label="Status" htmlFor="cf-status">
                  <Controller
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="cf-status">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(CONTACT_STATUS).map(([value, meta]) => (
                            <SelectItem key={value} value={value}>
                              {meta.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              ) : null}
              <Field label="Tags" htmlFor="cf-tags" hint="Separate with commas." className={editing ? undefined : "sm:col-span-2"}>
                <Input id="cf-tags" placeholder="vip, hot-lead" {...form.register("tags")} />
              </Field>
            </div>

            {!editing ? (
              <div className="grid grid-cols-1 gap-4 rounded-2xl border border-line bg-surface-2 p-4 sm:grid-cols-2">
                <Field label="Give to employee" htmlFor="cf-employee" hint="Optional. The contact appears in this person's call list.">
                  <Controller
                    control={form.control}
                    name="employee"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="cf-employee">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Nobody yet</SelectItem>
                          {employees.data?.items.map((e) => (
                            <SelectItem key={e.id} value={String(e.id)}>
                              {e.full_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
                <Field label="Add to campaign" htmlFor="cf-campaign" hint="Optional.">
                  <Controller
                    control={form.control}
                    name="campaign"
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger id="cf-campaign">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No campaign</SelectItem>
                          {campaigns.data?.map((c) => (
                            <SelectItem key={c.id} value={String(c.id)}>
                              {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm font-medium text-danger">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={isSubmitting} data-testid="contact-submit">
              {editing ? "Save contact" : "Add contact"}
            </Button>
          </DialogFooter>
      </form>
    </>
  );
}
