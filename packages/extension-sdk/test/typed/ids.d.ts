// The shape `dolphy-ext types` generates (the extension-tools tests prove the
// generator writes exactly this shape); these tests run with it in the program.
declare module '@dolphy-app/extension-sdk' {
  interface ExtensionIds {
    exerciseTypes: 'acme.echo';
    gradePolicies: 'acme.strict';
    commands: 'acme.a' | 'acme.b';
    events: 'attempt.closed';
    panels: 'acme.panel';
    importers: 'acme.in';
    exporters: 'acme.out' | 'acme.report';
    markdownLanguages: 'echo';
    settings: {
      'acme.goal': number;
      'acme.on': boolean;
      'acme.name': string;
      'acme.mode': 'fast' | 'slow';
    };
  }
}

export {};
