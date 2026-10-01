import React, { useEffect, useState } from 'react';

import { updateCall } from '../../database/calls';
import { toast } from '../../store/toastStore';
import { BottomSheet } from '../BottomSheet';
import { Button } from '../Button';
import { TextField } from '../TextField';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** the CRM call this note belongs to */
  sessionId: string;
  /** what was already written (earlier notes of this same call) */
  existing: string | null;
}

/**
 * A quick note while still on the phone. It is kept on the call and shows up pre-filled on the outcome screen, so nothing
 * has to be typed twice and nothing is lost if the app is closed before the outcome is saved.
 */
export function CallNoteSheet({ visible, onClose, sessionId, existing }: Props) {
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) setText('');
  }, [visible]);

  const save = async () => {
    const body = text.trim();
    if (!body) return;
    setSaving(true);
    try {
      await updateCall(sessionId, { notes: existing ? `${existing}\n${body}` : body });
      toast.success('Note added to this call');
      onClose();
    } catch {
      toast.error('Could not save the note. Try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Note for this call" keyboardAware>
      <TextField value={text} onChangeText={setText} placeholder="What did the customer say?" multiline multilineHeight={120} autoFocus maxLength={2000} />
      <Button title="Add note" icon="check" loading={saving} onPress={save} disabled={!text.trim()} />
    </BottomSheet>
  );
}
