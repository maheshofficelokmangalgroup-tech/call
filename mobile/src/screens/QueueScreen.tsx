import React, { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Animated, { FadeIn, FadeInDown, LinearTransition, SlideInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { ContactRow } from '../components/ContactRow';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { PressableScale } from '../components/PressableScale';
import { QueueCard } from '../components/QueueCard';
import { RowSkeleton } from '../components/Skeleton';
import { SegmentedControl } from '../components/SegmentedControl';
import { SyncBanner } from '../components/SyncBanner';
import { PullRefresh } from '../components/PullRefresh';
import { Text } from '../components/Text';
import { useQueue } from '../hooks/data';
import { useCallAction } from '../hooks/useCallAction';
import { useContactSearch } from '../hooks/useContactSearch';
import type { RootStackParamList, TabParamList } from '../navigation/types';
import type { Contact, QueueItem } from '../services/api/types';
import { syncEngine } from '../services/sync/syncEngine';
import { colors, fonts, radius, shadow } from '../theme';
import { formatPhone, pluralize } from '../utils/format';
import { haptics } from '../utils/haptics';

type Nav = NativeStackNavigationProp<RootStackParamList>;
type Segment = 'today' | 'all';

export function QueueScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProp<TabParamList, 'Queue'>>();
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = useState<Segment>(route.params?.segment ?? 'today');
  const queue = useQueue();
  const [search, setSearch] = useState('');
  const contacts = useContactSearch(search, segment === 'all');
  const call = useCallAction();

  const items = queue.data?.items ?? [];
  const first = items[0];

  const callQueueItem = useCallback(
    (item: QueueItem) => void call({ contactId: item.contact.id, contactName: item.contact.name, phone: item.contact.phone, campaignId: item.campaign?.id ?? null }),
    [call],
  );
  const callContact = useCallback(
    (contact: Contact) => void call({ contactId: contact.id, contactName: contact.name, phone: contact.phone }),
    [call],
  );
  const open = useCallback((contact: Contact) => navigation.navigate('ContactDetail', { contactId: contact.id, preview: contact }), [navigation]);

  const onRefreshToday = useCallback(async () => {
    haptics.tap();
    await syncEngine.syncNow();
    await queue.refresh();
  }, [queue]);

  return (
    <View style={styles.root}>
      <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
        <Text variant="title" style={styles.title}>
          My contacts
        </Text>
        <SegmentedControl<Segment>
          value={segment}
          onChange={setSegment}
          options={[
            { key: 'today', label: "Today's queue", badge: queue.data?.due_callbacks || undefined },
            { key: 'all', label: 'All contacts' },
          ]}
        />
        {segment === 'all' ? (
          <Animated.View entering={FadeIn.duration(200)} style={styles.searchWrap}>
            <Icon name="search" size={20} color={colors.muted} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search name, number, city, tag..."
              placeholderTextColor={colors.faint}
              style={styles.searchInput}
              returnKeyType="search"
              autoCorrect={false}
              testID="contact-search"
            />
            {search ? (
              <PressableScale onPress={() => setSearch('')} haptic={false} scaleTo={0.85} hitSlop={10}>
                <Icon name="x" size={18} color={colors.muted} />
              </PressableScale>
            ) : null}
          </Animated.View>
        ) : null}
      </View>

      {segment === 'today' ? (
        <FlatList<QueueItem>
          data={items}
          keyExtractor={(item) => String(item.contact.id)}
          contentContainerStyle={[styles.list, { paddingBottom: first ? 168 : 120 }]}
          showsVerticalScrollIndicator={false}
          refreshControl={<PullRefresh onRefresh={onRefreshToday} />}
          ListHeaderComponent={
            <View>
              <SyncBanner offline={queue.offline} />
              {items.length > 0 ? (
                <Text variant="small" color="muted" style={styles.count}>
                  {pluralize(queue.data?.total ?? items.length, 'contact')} to call
                  {queue.data && queue.data.due_callbacks > 0 ? `  •  ${pluralize(queue.data.due_callbacks, 'callback')} due` : ''}
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            queue.loading && !queue.data ? (
              <View>
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </View>
            ) : (
              <EmptyState
                icon="badge-check"
                title="All caught up!"
                message="No contacts are waiting right now. New assignments and due callbacks will show up here."
                actionLabel="Refresh"
                onAction={() => void onRefreshToday()}
              />
            )
          }
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 45).duration(360)} layout={LinearTransition.springify().damping(18)}>
              <QueueCard item={item} highlight={index === 0} onOpen={() => open(item.contact)} onCall={() => callQueueItem(item)} />
            </Animated.View>
          )}
        />
      ) : (
        <FlatList<Contact>
          data={contacts.items}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[styles.list, { paddingBottom: 120 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onEndReached={contacts.loadMore}
          onEndReachedThreshold={0.5}
          refreshControl={<PullRefresh onRefresh={contacts.refresh} />}
          ListHeaderComponent={
            <View>
              <SyncBanner offline={contacts.offline} />
              {contacts.items.length > 0 ? (
                <Text variant="small" color="muted" style={styles.count}>
                  {pluralize(contacts.total, 'contact')}
                  {search ? ` matching “${search}”` : ' assigned to you'}
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            contacts.loading ? (
              <View>
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </View>
            ) : (
              <EmptyState
                icon={search ? 'search' : 'users'}
                title={search ? 'No matches' : 'No contacts yet'}
                message={search ? 'Try a different name, number or city.' : 'Contacts assigned to you by your administrator will appear here.'}
              />
            )
          }
          ListFooterComponent={contacts.loadingMore ? <ActivityIndicator color={colors.green} style={styles.footer} /> : undefined}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(320)}>
              <ContactRow contact={item} onOpen={() => open(item)} onCall={() => callContact(item)} />
            </Animated.View>
          )}
        />
      )}

      {segment === 'today' && first ? (
        <Animated.View entering={SlideInDown.delay(300).springify().damping(16)} style={styles.nextBar}>
          <Avatar name={first.contact.name} size={42} />
          <View style={styles.nextText}>
            <Text variant="caption" color="rgba(255,255,255,0.75)">
              {first.reason === 'callback' ? 'CALLBACK DUE' : 'NEXT UP'}
            </Text>
            <Text variant="h3" color={colors.white} numberOfLines={1}>
              {first.contact.name}
            </Text>
            <Text variant="caption" color="rgba(255,255,255,0.8)" numberOfLines={1}>
              {formatPhone(first.contact.phone)}
            </Text>
          </View>
          <Button title="Call" icon="phone" variant="accent" size="md" onPress={() => callQueueItem(first)} testID="next-call" />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  top: { paddingBottom: 12 },
  title: { paddingHorizontal: 16, marginBottom: 12 },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 14,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontFamily: fonts.medium, fontSize: 14.5, color: colors.ink, paddingVertical: 0, includeFontPadding: false },
  list: { paddingHorizontal: 16 },
  count: { marginBottom: 10, marginLeft: 2 },
  footer: { marginVertical: 16 },
  nextBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    paddingLeft: 12,
    borderRadius: radius.xl,
    backgroundColor: colors.green,
    ...(shadow.floating as object),
  },
  nextText: { flex: 1 },
});
