import {
  defineExtension,
  defineExtensionWidget,
} from '@dolphy-app/extension-sdk';
import { useWidget } from '@dolphy-app/extension-sdk/client';
import { defineComponent, h } from 'vue';
import 'vuetify/styles';
import { VAlert } from 'vuetify/components';

export const host = defineExtension({});

export const widgets = {
  'acme.widget-host.card': defineExtensionWidget(
    defineComponent({
      setup() {
        const widget = useWidget();
        return () =>
          h(VAlert, { type: 'info' }, () => `WIDGET_ALERT ${widget.widgetId}`);
      },
    }),
  ),
};
