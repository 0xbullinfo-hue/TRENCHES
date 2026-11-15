import nextVitals from 'eslint-config-next/core-web-vitals';
import jsxA11y from 'eslint-plugin-jsx-a11y';

const config = [
  ...nextVitals,
  {
    // Enable full recommended rules from jsx-a11y (plugin already registered by nextVitals)
    rules: {
      ...jsxA11y.flatConfigs.recommended.rules,
      // React Compiler-era rules introduced with eslint-plugin-react-hooks v7.
      // Kept visible as warnings; refactor effects incrementally (see AUDIT_REPORT P2-10).
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
];

export default config;
