import js from '@eslint/js'; import globals from 'globals';
export default [{ignores:['dist/**','src/legacy-app.js']},js.configs.recommended,{files:['src/**/*.{js,jsx}','tests/**/*.js'],languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{...globals.browser,...globals.node}},rules:{'no-unused-vars':['error',{argsIgnorePattern:'^_'}]}}];
