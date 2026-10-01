// Native modules do not exist in the Jest (Node) environment. Tests that need behaviour override these mocks.
jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(async () => false),
  setGenericPassword: jest.fn(async () => ({ service: 'test', storage: 'test' })),
  resetGenericPassword: jest.fn(async () => true),
}));

jest.mock('@op-engineering/op-sqlite', () => ({
  open: jest.fn(() => ({ execute: jest.fn(async () => ({ rows: [], rowsAffected: 0 })), transaction: jest.fn() })),
}));
