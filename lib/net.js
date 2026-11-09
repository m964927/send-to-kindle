import { spawn } from 'node:child_process';

let preferred = [];

const PS_CMD =
  'Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null } | ' +
  'ForEach-Object { $_.IPv4Address.IPAddress }';

/**
 * 找出「有默认网关」的网卡 IP。
 * 电脑常有多张网卡（Hyper-V / VMware / VPN），它们的地址在其他设备上根本连不通，
 * 所以优先给出真正联网那张网卡的地址。
 */
export function detectPrimaryIps() {
  if (process.platform !== 'win32') return Promise.resolve([]);

  return new Promise((resolve) => {
    let out = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      const ips = out
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => /^\d+\.\d+\.\d+\.\d+$/.test(s));
      preferred = ips;
      resolve(ips);
    };

    let child;
    try {
      // 用参数数组调用，避免走 cmd.exe 时的引号/花括号解析问题
      child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_CMD], {
        windowsHide: true
      });
    } catch {
      return resolve([]);
    }

    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      finish();
    }, 12000);

    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', () => {
      clearTimeout(timer);
      finish();
    });
    child.on('close', () => {
      clearTimeout(timer);
      finish();
    });
  });
}

export function getPreferred() {
  return preferred;
}
