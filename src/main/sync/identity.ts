import { getSettings } from '../settings'

export interface DeviceIdentity {
  deviceId: string
  deviceName: string
}

export function getIdentity(): DeviceIdentity {
  const s = getSettings()
  return { deviceId: s.deviceId, deviceName: s.deviceName }
}
