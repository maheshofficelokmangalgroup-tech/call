import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useCachedQuery } from '../../hooks/useCachedQuery';
import type { CallIdentity } from '../../hooks/useCallIdentity';
import { api } from '../../services/api/endpoints';
import type { ContactDetail } from '../../services/api/types';
import { colors, radius } from '../../theme';
import { contactStatusLook } from '../../utils/status';
import { parseIso, timeAgo } from '../../utils/time';
import { Avatar } from '../Avatar';
import { BottomSheet } from '../BottomSheet';
import { Tag } from '../Chip';
import { Skeleton } from '../Skeleton';
import { Text } from '../Text';

function Line({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <View style={styles.line}>
      <Text variant="small" color="muted" style={styles.label}>
        {label}
      </Text>
      <Text variant="bodyMedium" style={styles.value} numberOfLines={2}>
        {String(value)}
      </Text>
    </View>
  );
}

/** What the employee needs to know about the customer without leaving the call. */
export function CallDetailsSheet({ visible, onClose, identity }: { visible: boolean; onClose: () => void; identity: CallIdentity }) {
  const contact = identity.contact;
  const contactId = contact?.id ?? null;
  const detail = useCachedQuery<ContactDetail>(
    identity.employeeId !== null && contactId !== null ? `e${identity.employeeId}:contact:${contactId}` : null,
    () => api.contact(contactId as number),
    { topics: ['contact'], enabled: visible && identity.employeeId !== null && contactId !== null },
  );
  const full = detail.data;
  const status = contact ? contactStatusLook(contact.status) : null;
  const last = parseIso(contact?.last_called_at);
  const custom = Object.entries(full?.custom_fields ?? {}).filter(([, v]) => v !== null && v !== '');

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Customer details">
      <View style={styles.head}>
        <Avatar name={identity.title} size={52} />
        <View style={styles.headText}>
          <Text variant="h1" numberOfLines={1}>
            {identity.title}
          </Text>
          <Text variant="small" color="muted">
            {identity.phone}
          </Text>
        </View>
      </View>

      {!contact ? (
        <View style={styles.empty}>
          <Text variant="body" color="muted">
            This number is not in your CRM list, so there are no customer details to show.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.tags}>
            {status ? <Tag label={status.label} color={status.color} background={status.bg} /> : null}
            {contact.tags.map((t) => (
              <Tag key={t} label={t} color={colors.inkSoft} background="#EEF0F3" />
            ))}
          </View>
          <Line label="Location" value={contact.location} />
          <Line label="Category" value={contact.category} />
          <Line label="Calls so far" value={contact.call_count} />
          <Line label="Last called" value={last ? timeAgo(last) : 'Never'} />
          {detail.loading && !full ? <Skeleton height={16} width="70%" /> : null}
          {custom.map(([key, value]) => (
            <Line key={key} label={key} value={String(value)} />
          ))}
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  headText: { flex: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  line: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.border },
  label: { width: 104 },
  value: { flex: 1 },
  empty: { padding: 14, borderRadius: radius.lg, backgroundColor: colors.bg },
});
