module.exports = {
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint', 'drizzle'],
    extends: ['eslint:recommended', '@typescript-eslint/recommended'],
    root: true,
    env: {
        node: true,
    },
    rules: {
        'no-console': 'off',
    },
};
