/**
 * Jest manual mock for `react-native`.
 *
 * The contract tests import the full `Sankofa` object from
 * `../src/index`, which transitively imports `react-native` for
 * `Platform.OS` and `Platform.Version`.  Without this mock Jest tries
 * to evaluate RN's flow-typed source and crashes on `import typeof *
 * from './index.js.flow'`.
 *
 * Only the surface our SDK actually touches is re-implemented here.
 * Add to it if a future test needs another RN export.
 */

export const Platform = {
  OS: 'ios' as 'ios' | 'android' | 'web',
  Version: '17.0',
  select<T>(spec: { ios?: T; android?: T; default?: T }): T | undefined {
    return spec.ios ?? spec.default;
  },
};

/**
 * Minimal `StyleSheet.create` shim — returns the input verbatim.  The
 * Pulse SurveyModal calls this at module-eval time (top-level
 * `const styles = StyleSheet.create({ … })`); without it a Phase A
 * test that imports from `../src/index` (which transitively imports
 * Pulse) crashes during module load.  Real RN's StyleSheet does
 * extra registry work for native bridging, but we don't render
 * here — passthrough is sufficient.
 */
export const StyleSheet = {
  create<T extends Record<string, object>>(styles: T): T {
    return styles;
  },
  flatten<T>(style: T): T {
    return style;
  },
  hairlineWidth: 1,
  absoluteFill: {} as object,
  absoluteFillObject: {} as object,
};

// Stubs for components SurveyModal references at module load.  None
// are actually rendered in these tests — they exist purely so
// require()ing the file doesn't crash.
const passthrough = (() => null) as unknown as React.ComponentType<unknown>;
export const Modal = passthrough;
export const View = passthrough;
export const Text = passthrough;
export const TouchableOpacity = passthrough;
export const ScrollView = passthrough;
export const TextInput = passthrough;
export const Animated = {
  View: passthrough,
  Value: class { constructor(_v: number) {} },
  timing: () => ({ start: () => {} }),
  spring: () => ({ start: () => {} }),
};
export const KeyboardAvoidingView = passthrough;
export const Pressable = passthrough;
export const Image = passthrough;
export const ActivityIndicator = passthrough;
export const Linking = {
  openURL: async (_: string) => {},
};
export const Dimensions = {
  get: () => ({ width: 375, height: 812 }),
};
