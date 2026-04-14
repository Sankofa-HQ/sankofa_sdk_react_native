let configPlugins;
try {
  configPlugins = require('@expo/config-plugins');
} catch {
  configPlugins = require(require.resolve('@expo/config-plugins', {
    paths: [process.cwd()],
  }));
}

const { withAppDelegate, withMainApplication } = configPlugins;

function ensureImport(src, importLine) {
  if (src.includes(importLine)) return src;
  const lines = src.split('\n');
  const lastImport = lines.map((line, index) => ({ line, index }))
    .filter(({ line }) => line.startsWith('import '))
    .pop();
  if (!lastImport) {
    return `${importLine}\n${src}`;
  }
  lines.splice(lastImport.index + 1, 0, importLine);
  return lines.join('\n');
}

function patchAndroidMainApplication(src) {
  if (src.includes('SankofaDeployBundleProvider.getJSBundleFile')) {
    return src;
  }

  let next = ensureImport(src, 'import dev.sankofa.rn.SankofaDeployBundleProvider');
  const existingOverride = /override fun getJSBundleFile\(\): String\?\s*\{([\s\S]*?)\n\s*\}/m;
  if (existingOverride.test(next)) {
    return next.replace(existingOverride, (match) => {
      if (!match.includes('return ')) {
        throw new Error('Sankofa Deploy config plugin could not patch getJSBundleFile(); add the provider snippet manually.');
      }
      return match.replace(
        'return ',
        'return SankofaDeployBundleProvider.getJSBundleFile(applicationContext) ?: ',
      );
    });
  }

  const anchor = 'override fun getUseDeveloperSupport()';
  const index = next.indexOf(anchor);
  if (index === -1) {
    throw new Error('Sankofa Deploy config plugin could not find ReactNativeHost in MainApplication.kt.');
  }

  const method = [
    '    override fun getJSBundleFile(): String? {',
    '      return SankofaDeployBundleProvider.getJSBundleFile(applicationContext) ?: super.getJSBundleFile()',
    '    }',
    '',
  ].join('\n');
  return `${next.slice(0, index)}${method}${next.slice(index)}`;
}

function patchIosAppDelegate(src) {
  let hasBundleHook = src.includes('sankofaDeployBundleURL()') || src.includes('SankofaDeployBundleProvider.bundleURL()');
  if (src.includes('SankofaDeployBundleProvider.bundleURL()')) {
    src = src.replace(/SankofaDeployBundleProvider\.bundleURL\(\)/g, 'sankofaDeployBundleURL()');
  }

  let next = ensureImport(src, 'import SankofaReactNative');
  if (!next.includes('private func sankofaDeployBundleURL() -> URL?')) {
    const helper = [
      'private func sankofaDeployBundleURL() -> URL? {',
      '  let selector = NSSelectorFromString("bundleURL")',
      '  for className in ["SankofaDeployBundleProvider", "SankofaReactNative.SankofaDeployBundleProvider"] {',
      '    guard let provider = NSClassFromString(className) as? NSObject.Type,',
      '          provider.responds(to: selector),',
      '          let value = provider.perform(selector)?.takeUnretainedValue() as? URL else {',
      '      continue',
      '    }',
      '    return value',
      '  }',
      '  return nil',
      '}',
      '',
    ].join('\n');
    const delegateIndex = next.indexOf('class ReactNativeDelegate');
    if (delegateIndex === -1) {
      throw new Error('Sankofa Deploy config plugin could not find ReactNativeDelegate in AppDelegate.swift.');
    }
    next = `${next.slice(0, delegateIndex)}${helper}${next.slice(delegateIndex)}`;
  }

  if (hasBundleHook) {
    return next;
  }

  const bundleMethod = /override func bundleURL\(\) -> URL\? \{([\s\S]*?)\n\s*\}/m;
  if (!bundleMethod.test(next)) {
    throw new Error('Sankofa Deploy config plugin could not find bundleURL() in AppDelegate.swift.');
  }

  return next.replace(bundleMethod, (match) => {
    const releaseReturn = 'return Bundle.main.url(forResource: "main", withExtension: "jsbundle")';
    if (match.includes(releaseReturn)) {
      return match.replace(
        releaseReturn,
        'if let sankofaURL = sankofaDeployBundleURL() { return sankofaURL }\n    ' + releaseReturn,
      );
    }
    return match.replace(
      /\n\s*return ([^\n]+)\n\s*\}/,
      '\n    if let sankofaURL = sankofaDeployBundleURL() { return sankofaURL }\n    return $1\n  }',
    );
  });
}

module.exports = function withSankofaDeploy(config) {
  config = withMainApplication(config, (mod) => {
    mod.modResults.contents = patchAndroidMainApplication(mod.modResults.contents);
    return mod;
  });

  config = withAppDelegate(config, (mod) => {
    mod.modResults.contents = patchIosAppDelegate(mod.modResults.contents);
    return mod;
  });

  return config;
};
