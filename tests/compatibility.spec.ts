import { describe, expect, it } from 'vitest'

import {
  assertCompatibility,
  inspectCompatibility,
  REQUIRED_CORE_CAPABILITIES,
} from '../src/compatibility.js'
import { Flow2SpecDshError } from '../src/errors.js'

function completeCore() {
  return {
    protocolVersion: 2,
    capabilities: REQUIRED_CORE_CAPABILITIES.map(id => ({ id })),
  }
}

describe('compatibility', () => {
  it('accepts the verified host and complete protocol', () => {
    expect(inspectCompatibility({
      core: completeCore(),
      hostVersion: '0.1.0-rc.8',
      cordisVersion: '4.0.1',
    })).toMatchObject({ ok: true, missingCapabilities: [] })
  })

  it('rejects missing core capabilities', () => {
    try {
      assertCompatibility({ core: { protocolVersion: 2, capabilities: [] } })
      expect.fail('expected compatibility assertion to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(Flow2SpecDshError)
      expect((error as Flow2SpecDshError).code).toBe('F2S_DSH_CORE_CAPABILITY_MISSING')
    }
  })

  it('rejects unsupported host versions', () => {
    try {
      assertCompatibility({ core: completeCore(), hostVersion: '0.2.0' })
      expect.fail('expected compatibility assertion to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(Flow2SpecDshError)
      expect((error as Flow2SpecDshError).code).toBe('F2S_DSH_HOST_UNSUPPORTED')
    }
  })

  it('rejects the previous rc.7 baseline', () => {
    try {
      assertCompatibility({ core: completeCore(), hostVersion: '0.1.0-rc.7' })
      expect.fail('expected compatibility assertion to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(Flow2SpecDshError)
      expect((error as Flow2SpecDshError).code).toBe('F2S_DSH_HOST_UNSUPPORTED')
    }
  })
})
