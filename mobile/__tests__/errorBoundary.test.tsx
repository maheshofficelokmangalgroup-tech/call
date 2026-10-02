import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

import { ErrorBoundary } from '../src/components/ErrorBoundary';

let explode = true;
function Bomb() {
  if (explode) throw new Error('boom while drawing');
  return <Text testID="fine">all good</Text>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    explode = true;
    jest.spyOn(console, 'error').mockImplementation(() => undefined); // React and the boundary both report the error
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows a message instead of closing the app, and builds the screen again on "Try again"', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ErrorBoundary label="home">
          <Bomb />
        </ErrorBoundary>,
      );
    });
    expect(tree.root.findAllByProps({ testID: 'error-boundary' }).length).toBeGreaterThan(0);
    expect(JSON.stringify(tree.toJSON())).toContain('boom while drawing');

    explode = false; // the cause has gone (a retry of the network, fresh data)
    act(() => {
      tree.root.findByProps({ testID: 'error-boundary-retry' }).props.onPress();
    });
    expect(tree.root.findAllByProps({ testID: 'fine' }).length).toBeGreaterThan(0);
    expect(tree.root.findAllByProps({ testID: 'error-boundary' })).toHaveLength(0);
  });

  it('is invisible when nothing is wrong', () => {
    explode = false;
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ErrorBoundary>
          <Bomb />
        </ErrorBoundary>,
      );
    });
    expect(JSON.stringify(tree.toJSON())).toContain('all good');
  });
});
