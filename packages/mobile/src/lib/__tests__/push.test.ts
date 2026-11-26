import AsyncStorage from "@react-native-async-storage/async-storage";

const mockFb = {
  status: 1,
  getToken: jest.fn(async () => "token-1"),
  requestPermission: jest.fn(async () => 1),
  deleteToken: jest.fn(async () => {}),
};
jest.mock("@react-native-firebase/messaging", () => ({
  AuthorizationStatus: { NOT_DETERMINED: -1, DENIED: 0, AUTHORIZED: 1, PROVISIONAL: 2, EPHEMERAL: 3 },
  getMessaging: () => ({}),
  hasPermission: async () => mockFb.status,
  requestPermission: () => mockFb.requestPermission(),
  getToken: () => mockFb.getToken(),
  deleteToken: () => mockFb.deleteToken(),
  onTokenRefresh: () => () => {},
  isDeviceRegisteredForRemoteMessages: () => false,
  registerDeviceForRemoteMessages: async () => {},
  getInitialNotification: async () => null,
  onNotificationOpenedApp: () => () => {},
}));

let mockHasFirebase = true;
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { push: mockHasFirebase } };
    },
  },
}));

const mockSave = jest.fn(async () => ({ ok: true }));
const mockRemove = jest.fn(async () => ({ ok: true }));
jest.mock("@/api/push", () => ({ pushApi: { save: (...a: unknown[]) => mockSave(...(a as [])), remove: (...a: unknown[]) => mockRemove(...(a as [])) } }));

// Fresh module state (the "registered" flag) for every test.
let push: typeof import("../push");
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
  mockFb.status = 1;
  mockHasFirebase = true;
  jest.isolateModules(() => {
    push = require("../push");
  });
});

test("a tap opens only an in-app path", () => {
  expect(push.notificationPath({ data: { path: "/spending" } })).toBe("/spending");
  expect(push.notificationPath({ data: { path: "https://evil.example" } })).toBeNull();
  expect(push.notificationPath({ data: {} })).toBeNull();
  expect(push.notificationPath(null)).toBeNull();
});

test("a build without the Firebase config has no push and makes no calls", async () => {
  mockHasFirebase = false;
  expect(push.pushAvailable()).toBe(false);
  await push.registerPush();
  expect(mockSave).not.toHaveBeenCalled();
  await push.signOutPush();
  expect(mockRemove).not.toHaveBeenCalled();
});

test("registering sends this device's token once", async () => {
  await push.registerPush();
  await push.registerPush();
  expect(mockSave).toHaveBeenCalledTimes(1);
  expect(mockSave).toHaveBeenCalledWith("token-1", "ios");
});

test("the first time, it asks for permission", async () => {
  mockFb.status = -1;
  await push.registerPush();
  expect(mockFb.requestPermission).toHaveBeenCalled();
  expect(mockSave).toHaveBeenCalled();
});

test("permission refused: no token is sent", async () => {
  mockFb.status = 0;
  await push.registerPush();
  expect(mockSave).not.toHaveBeenCalled();
  expect(await push.getPushState()).toBe("blocked");
});

test("turning it off removes the token and keeps it off across launches", async () => {
  await push.registerPush();
  expect(await push.setPushEnabled(false)).toBe("off");
  expect(mockRemove).toHaveBeenCalledWith("token-1");
  mockSave.mockClear();
  await push.registerPush();
  expect(mockSave).not.toHaveBeenCalled();
});

test("sign-out removes the token and resets the choice for the next account", async () => {
  await push.setPushEnabled(false);
  await push.signOutPush();
  expect(await AsyncStorage.getItem("lasagna_push_off")).toBeNull();
  await push.registerPush();
  expect(mockSave).toHaveBeenCalled();
});
