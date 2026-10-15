/**
 * The provider registry as the installed SDK declares it.
 *
 * Attribution tests compare a tool's `sources` with these rather than with the
 * fakes, so a fixture that drifted from the real registry fails loudly instead
 * of agreeing with itself.
 */

import { providerDescriptors } from "norway-open-data-sdk";

type RegistryId = keyof typeof providerDescriptors;

/** The source block the SDK attaches to a response from this provider. */
export function registrySource(id: RegistryId): {
  id: string;
  name: string;
  homepage: string;
  documentation: string;
  license?: string;
  attribution?: string;
} {
  const descriptor = providerDescriptors[id] as {
    id: string;
    name: string;
    homepage: string;
    documentation: string;
    license?: string;
    attribution?: string;
  };
  return {
    id: descriptor.id,
    name: descriptor.name,
    homepage: descriptor.homepage,
    documentation: descriptor.documentation,
    ...(descriptor.license !== undefined ? { license: descriptor.license } : {}),
    ...(descriptor.attribution !== undefined ? { attribution: descriptor.attribution } : {}),
  };
}
