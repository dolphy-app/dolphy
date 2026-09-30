import { createRouter, createWebHashHistory } from 'vue-router';
import { CoursesPage } from '@/pages/courses';
import { DailyPlanPage } from '@/pages/daily-plan';
import { SessionPage } from '@/pages/session';
import {
  SettingsAbout,
  SettingsAppearance,
  SettingsLearning,
  SettingsLibrary,
  SettingsPage,
} from '@/pages/settings';
import { ROUTE } from '@/shared/config/routes.ts';
import ShellLayout from '../layouts/ShellLayout.vue';

declare module 'vue-router' {
  interface RouteMeta {
    /** Пункт бокового меню (`titleKey` — ключ сообщения); без `nav` в меню не попадает. */
    nav?: {
      titleKey: string;
      icon: string;
      order: number;
      /** `bottom` — под основным списком, у нижнего края. */
      placement?: 'top' | 'bottom';
    };
  }
}

// renderer грузится через file:// (loadFile), поэтому только hash-история
export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      component: ShellLayout,
      children: [
        {
          path: '',
          name: ROUTE.dailyPlan,
          component: DailyPlanPage,
          meta: {
            nav: {
              titleKey: 'nav.dailyPlan',
              icon: 'mdi-calendar-check',
              order: 1,
            },
          },
        },
        {
          path: 'courses',
          name: ROUTE.courses,
          component: CoursesPage,
          meta: {
            nav: {
              titleKey: 'nav.courses',
              icon: 'mdi-bookshelf',
              order: 2,
            },
          },
        },
        {
          path: 'settings',
          component: SettingsPage,
          children: [
            {
              path: '',
              name: ROUTE.settings,
              redirect: { name: ROUTE.settingsLearning },
              meta: {
                nav: {
                  titleKey: 'nav.settings',
                  icon: 'mdi-cog-outline',
                  order: 100,
                  placement: 'bottom',
                },
              },
            },
            {
              path: 'learning',
              name: ROUTE.settingsLearning,
              component: SettingsLearning,
            },
            {
              path: 'library',
              name: ROUTE.settingsLibrary,
              component: SettingsLibrary,
            },
            {
              path: 'appearance',
              name: ROUTE.settingsAppearance,
              component: SettingsAppearance,
            },
            {
              path: 'about',
              name: ROUTE.settingsAbout,
              component: SettingsAbout,
            },
          ],
        },
      ],
    },
    { path: '/session', name: ROUTE.session, component: SessionPage },
  ],
});
