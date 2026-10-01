import React, { useCallback, useState } from 'react';
import { RefreshControl, type RefreshControlProps } from 'react-native';

import { colors } from '../theme';

interface Props extends Omit<RefreshControlProps, 'refreshing' | 'onRefresh'> {
  onRefresh: () => Promise<void> | void;
}

/**
 * Pull-to-refresh whose spinner shows only for the employee's own pull. The screens also refresh by themselves (sync, new
 * data); those silent refreshes must not make the list flash a spinner.
 *
 * On Android the ScrollView hands the scrolling content to its refreshControl element as `children`, so everything else
 * (children, style) has to be passed straight through.
 */
export function PullRefresh({ onRefresh, ...rest }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const run = useCallback(async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }, [onRefresh]);
  return <RefreshControl colors={[colors.green]} tintColor={colors.green} {...rest} refreshing={refreshing} onRefresh={run} />;
}
