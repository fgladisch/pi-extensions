/** Jest config for the pi extensions workspace. */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: __dirname,
  // Test files live under tests/ so pi's auto-discovery (which loads
  // *.ts at the root and */index.ts in subdirectories) ignores them.
  testMatch: ["<rootDir>/tests/**/*.spec.ts"],
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { diagnostics: false }],
  },
  collectCoverageFrom: [
    "bash-approval.ts",
    "user-select.ts",
    "welcome-message.ts",
  ],
  coverageDirectory: "<rootDir>/coverage",
  coverageThreshold: {
    global: {
      lines: 80,
      branches: 80,
      functions: 80,
      statements: 80,
    },
  },
};
