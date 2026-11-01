/** Jest + React Native Testing Library (07-repo §CI step 7). */
module.exports = {
  preset: 'jest-expo',
  setupFiles: ['./test/setup.ts'],
  testMatch: ['<rootDir>/test/**/*.test.ts?(x)'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm|((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|react-native-sse|@compound/.*))',
  ],
  collectCoverageFrom: ['src/lib/**/*.{ts,tsx}', '!src/lib/i18n/*.ts'],
};
