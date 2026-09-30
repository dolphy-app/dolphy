import { startRestrictedChild } from '@spirula-app/extension-host';

// Вход ограниченного дочернего процесса хоста расширений. Собирается отдельным
// самодостаточным файлом (`restricted/ext-restricted.mjs`, см. vite.config.ts) и
// запускается с `--permission`: читать ему разрешён только свой каталог.
startRestrictedChild();
