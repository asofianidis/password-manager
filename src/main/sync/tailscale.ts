import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { promisify } from 'util'
import type { TailscalePeer } from '../../shared/types'

const execFileAsync = promisify(execFile)

/** GUI-launched apps on macOS don't inherit the shell PATH, so check the usual install locations. */
const CANDIDATES = [
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/opt/homebrew/bin/tailscale',
  '/usr/local/bin/tailscale',
  '/usr/bin/tailscale',
  'C:\\Program Files\\Tailscale\\tailscale.exe'
]

function findTailscale(): string {
  return CANDIDATES.find((path) => existsSync(path)) ?? 'tailscale'
}

interface StatusNode {
  HostName: string
  DNSName: string
  TailscaleIPs: string[] | null
  OS: string
  Online: boolean
}

/** Lists devices on the local tailnet using the Tailscale CLI. Nothing leaves this machine. */
export async function listTailscalePeers(): Promise<TailscalePeer[]> {
  let stdout: string
  try {
    ;({ stdout } = await execFileAsync(findTailscale(), ['status', '--json'], { timeout: 5000 }))
  } catch {
    throw new Error('Tailscale CLI not found or not running. Is Tailscale installed and connected?')
  }
  const status = JSON.parse(stdout) as { Self?: StatusNode; Peer?: Record<string, StatusNode> }
  const toPeer = (node: StatusNode, self: boolean): TailscalePeer => ({
    name: node.HostName,
    dnsName: node.DNSName.replace(/\.$/, ''),
    ips: node.TailscaleIPs ?? [],
    os: node.OS,
    online: self || node.Online,
    self
  })
  const peers = Object.values(status.Peer ?? {}).map((node) => toPeer(node, false))
  peers.sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name))
  return status.Self ? [toPeer(status.Self, true), ...peers] : peers
}
