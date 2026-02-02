# Installation Log - FreePBX Setup and Integration

## Project Overview
This document details the installation process and challenges encountered while setting up the AI-PBX Integration Gateway project. The goal was to create a middleware service connecting FreePBX telephony events with AI processing capabilities.

---

## Environment Setup

### Host System
- **OS**: Windows 11 Pro (64-bit)
- **RAM**: 24 GB
- **Available Storage**: 1.5 TB (S: drive)
- **Virtualization**: Oracle VirtualBox 7.2.6

### Virtual Machine Configuration
- **Hypervisor**: VirtualBox with NAT networking
- **Guest OS**: Debian 12 (Bookworm) - netinst ISO
- **Allocated RAM**: 4 GB
- **Virtual Disk**: 25 GB (VDI format)
- **Network**: NAT with port forwarding (SSH: 2222, HTTP: 8080, AMI: 5038, ARI: 8088)

---

## Phase 1: Infrastructure Setup

### Challenge 1: Debian Installation Freezing
**Issue**: During initial Debian installation, the system froze at "Setting up partitioner" (13% loading) and remained stuck for over 30 minutes.

**Root Cause**: The VM was configured with bridged networking targeting the Ethernet adapter, but the host system was using WiFi. The DHCP autoconfiguration process timed out waiting for network connectivity.

**Solution**: 
- Changed network adapter from bridged Ethernet to bridged WiFi
- Later switched to NAT networking for better stability and simpler configuration
- NAT networking eliminated DHCP dependency issues

**Lesson Learned**: For development VMs, NAT networking provides more reliable connectivity than bridged mode, especially on systems with multiple network interfaces.

---

### Challenge 2: Hostname Configuration Error
**Issue**: FreePBX installer failed during postfix configuration with error:
```
newaliases: warning: valid_hostname: invalid character 33(decimal): freepbx.FreePBX123!
newaliases: fatal: file /etc/postfix/main.cf: parameter myhostname: bad parameter value: freepbx.FreePBX123!
```

**Root Cause**: During Debian installation, the password (FreePBX123!) was accidentally included in the hostname field, creating an invalid hostname containing special characters.

**Solution**:
```bash
hostnamectl set-hostname freepbx
echo "127.0.0.1 localhost" > /etc/hosts
echo "127.0.1.1 freepbx" >> /etc/hosts
sed -i 's/myhostname = .*/myhostname = freepbx/' /etc/postfix/main.cf
dpkg --configure -a
```

**Lesson Learned**: Always validate system configuration inputs. Hostname fields have strict RFC requirements (alphanumeric and hyphens only).

---

### Challenge 3: FreePBX Installer Script Version
**Issue**: Initial attempt to download FreePBX installer script targeted Debian 12.9.0, but the version had been archived and the URL was no longer valid (404 error).

**Root Cause**: Debian point releases are frequently updated. The direct version-specific URL became obsolete between project planning and execution.

**Solution**: Used the archived repository URL:
```bash
wget https://github.com/FreePBX/sng_freepbx_debian_install/raw/master/sng_freepbx_debian_install.sh
```

**Lesson Learned**: For production deployments, use stable channel URLs rather than version-specific paths. Archive repositories should be considered for older versions.

---

## Phase 2: FreePBX Configuration

### Challenge 4: Web Interface Firewall Prompts
**Issue**: After FreePBX installation, the web interface repeatedly showed firewall configuration dialogs that would freeze or timeout when attempting to configure automatically.

**Root Cause**: The Sangoma Smart Firewall module attempted to auto-detect external IP settings, which caused AJAX request timeouts in the NAT environment.

**Solution**: 
- Bypassed automatic firewall configuration by clicking "Abort"
- Manually configured firewall settings later through Advanced Settings
- This allowed access to the main administration interface without blocking initial setup

**Lesson Learned**: In virtualized/NAT environments, automatic network detection tools may not function correctly. Manual configuration is often more reliable.

---

### Challenge 5: Extensions Menu Location Change
**Issue**: Could not find "Extensions" option under the Applications menu as expected from FreePBX 16 documentation.

**Root Cause**: FreePBX 17 reorganized the menu structure, moving Extensions from Applications to a new Connectivity menu category.

**Solution**: Located Extensions under Connectivity > Extensions instead of Applications menu.

**Lesson Learned**: Always reference documentation specific to the installed version. Menu reorganization is common between major releases.

---

### Challenge 6: ARI Disabled by Default
**Issue**: When attempting to create ARI users, system showed warning: "The Asterisk REST Interface is Currently Disabled in Advanced Settings"

**Root Cause**: FreePBX 17 ships with ARI disabled by default for security reasons.

**Solution**: 
- Navigate to Settings > Advanced Settings
- Search for "Asterisk REST Interface"
- Enable the interface
- Return to Settings > Asterisk REST Interface Users to create users

**Lesson Learned**: Modern PBX systems disable potentially dangerous features by default. Always check feature toggles in Advanced Settings when interfaces are unavailable.

---

## Phase 3: Middleware Development

### Challenge 7: SQLite Native Compilation
**Issue**: Initial implementation used `better-sqlite3` package which failed during npm install with native compilation errors on Windows.

**Error Output**:
```
gyp ERR! build error
gyp ERR! stack Error: `C:\Program Files\Microsoft Visual Studio\...` failed with exit code: 1
```

**Root Cause**: `better-sqlite3` requires native C++ compilation toolchain (node-gyp, Visual Studio Build Tools) which was not installed on the development system.

**Solution**: Switched to `sql.js` - a pure JavaScript SQLite implementation compiled from C to WebAssembly. No native compilation required.

**Trade-off**: sql.js is ~30% slower than better-sqlite3 for write operations but eliminates build complexity and cross-platform issues.

**Lesson Learned**: For development environments and projects requiring cross-platform compatibility, pure JavaScript alternatives may be preferable to native modules despite minor performance costs.

---

### Challenge 8: AMI Connection Stability
**Issue**: asterisk-manager npm package was causing excessive reconnection attempts when Asterisk was unavailable, flooding logs and consuming resources.

**Root Cause**: The library's `keepConnected` option creates an infinite reconnection loop with no backoff strategy.

**Solution**:
```javascript
// Disabled keepConnected and implemented custom reconnection logic
const client = new AMIClient({
    keepConnected: false,  // Disable library's reconnection
    // Custom MAX_RECONNECT_ATTEMPTS implemented in wrapper
});
```

Implemented controlled reconnection with exponential backoff and maximum retry limits.

**Lesson Learned**: Third-party libraries may not implement reconnection strategies suitable for all use cases. Custom connection management provides better control over resource usage.

---

## Final Configuration

### FreePBX Settings
- **Version**: FreePBX 17.0.25 on Asterisk 22.7.0
- **Extensions Created**: 
  - Extension 101 (PJSIP)
  - Extension 102 (PJSIP)
- **AMI User**: ai-gateway (full permissions on localhost)
- **ARI User**: ai-gateway (read-write access)

### Middleware Service
- **Runtime**: Node.js 18+ (ES Modules)
- **Database**: sql.js (in-memory SQLite with persistence)
- **API Server**: Express 4.18.2 on port 3000
- **Endpoints**: GET /calls, GET /health, GET /status

---

## Installation Time Summary

| Phase | Duration | Notes |
|-------|----------|-------|
| VirtualBox + Debian Install | ~45 min | Including troubleshooting network issues |
| FreePBX Installation | ~35 min | Automated installer handled most work |
| Extension Configuration | ~10 min | Manual creation via web UI |
| AMI/ARI Setup | ~15 min | Including finding correct menu locations |
| Middleware Development | ~2 hours | Including dependency issue resolution |
| **Total** | **~3.5 hours** | First-time installation with documentation |

---

## Recommendations for Future Installations

1. **Use NAT networking** for VirtualBox VMs during development - more reliable than bridged mode
2. **Verify hostname** during Debian installation to avoid postfix configuration issues
3. **Allocate at least 4GB RAM** to FreePBX VM for smooth operation
4. **Enable ARI in Advanced Settings** before attempting to create ARI users
5. **Use sql.js over better-sqlite3** for Windows development to avoid native build requirements
6. **Implement custom reconnection logic** rather than relying on library defaults for AMI/ARI connections
7. **Check FreePBX version-specific documentation** for menu locations and feature availability

---

## Conclusion

The installation was successful despite several challenges related to network configuration, hostname validation, and dependency management. Most issues were related to differences between documentation (written for FreePBX 16/older versions) and the actual FreePBX 17 implementation. The middleware service is functional and demonstrates successful integration with Asterisk's AMI and ARI interfaces.

Total time from project start to working prototype: approximately 3.5 hours, with additional time spent on documentation and code refinement.
