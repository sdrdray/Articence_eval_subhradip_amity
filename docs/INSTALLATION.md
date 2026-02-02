# FreePBX 17 Installation Guide on Debian 12

This guide documents the installation of FreePBX 17 on Debian 12 using the official `sng_freepbx_debian_install` script.

## Prerequisites

- Fresh Debian 12 (Bookworm) installation
- Minimum 2GB RAM, 20GB disk space
- Root access
- Internet connectivity

## Phase 1: Installation

### Step 1: System Preparation

```bash
# Update system
apt update && apt upgrade -y

# Install required packages
apt install -y wget curl gnupg2 lsb-release
```

### Step 2: Run FreePBX Installation Script

```bash
# Download the official installation script
wget https://github.com/FreePBX/sng_freepbx_debian_install/raw/master/sng_freepbx_debian_install.sh

# Make executable
chmod +x sng_freepbx_debian_install.sh

# Run installation (takes 30-60 minutes)
./sng_freepbx_debian_install.sh
```

### Installation Log / Hurdles Faced

```
[Document your installation experience here]

Example hurdles and solutions:

1. ISSUE: PHP version conflicts
   SOLUTION: The script handles this automatically by installing PHP 8.2

2. ISSUE: MariaDB connection errors
   SOLUTION: Ensure no existing MySQL/MariaDB installation

3. ISSUE: Apache virtual host conflicts
   SOLUTION: Disable default site: a2dissite 000-default

4. ISSUE: Firewall blocking ports
   SOLUTION: 
   ufw allow 80/tcp
   ufw allow 443/tcp
   ufw allow 5060/udp
   ufw allow 5061/tcp
   ufw allow 10000:20000/udp
```

### Step 3: Access FreePBX Dashboard

1. Open browser: `http://YOUR_SERVER_IP`
2. Complete initial setup wizard
3. Create admin user
4. Apply configuration

## Phase 2: Configuration

### Create PJSIP Extensions (101 and 102)

#### Via FreePBX GUI:

1. Navigate to **Applications → Extensions**
2. Click **Add Extension → Add New PJSIP Extension**

**Extension 101:**
```
User Extension: 101
Display Name: User 101
Secret: <generate strong password>
```

**Extension 102:**
```
User Extension: 102
Display Name: User 102
Secret: <generate strong password>
```

3. Click **Submit** then **Apply Config**

#### Via CLI (alternative):

```bash
asterisk -rx "pjsip show endpoints"
```

### Enable AMI (Asterisk Manager Interface)

#### Method 1: Via FreePBX GUI

1. Navigate to **Settings → Asterisk Manager Users**
2. Click **Add Manager**
3. Configure:

```
Manager Name: ai-gateway
Manager Secret: your_secure_password
Deny: 0.0.0.0/0.0.0.0
Permit: 127.0.0.1/255.255.255.255

Read Permissions: ☑ all, ☑ call, ☑ cdr, ☑ dialplan, ☑ originate
Write Permissions: ☑ all, ☑ call, ☑ originate
```

4. Submit and Apply Config

#### Method 2: Via Configuration Files

Create `/etc/asterisk/manager.d/ai-gateway.conf`:

```ini
[ai-gateway]
secret = your_secure_password
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.255
read = system,call,log,verbose,command,agent,user,dtmf,originate,dialplan,cdr
write = system,call,log,verbose,command,agent,user,originate
```

Reload AMI:
```bash
asterisk -rx "manager reload"
```

Test connection:
```bash
telnet localhost 5038
# Type: Action: Login
# Type: Username: ai-gateway
# Type: Secret: your_secure_password
# Type: [blank line]
```

### Enable ARI (Asterisk REST Interface)

#### Step 1: Configure HTTP Server

Edit `/etc/asterisk/http.conf`:

```ini
[general]
enabled = yes
bindaddr = 0.0.0.0
bindport = 8088
```

#### Step 2: Configure ARI

Edit `/etc/asterisk/ari.conf`:

```ini
[general]
enabled = yes
pretty = yes
allowed_origins = *

[ai-bridge]
type = user
read_only = no
password = your_secure_password
```

#### Step 3: Reload Configuration

```bash
asterisk -rx "module reload res_ari.so"
asterisk -rx "ari show users"
```

#### Step 4: Test ARI

```bash
curl -u ai-bridge:your_secure_password \
  http://localhost:8088/ari/asterisk/info
```

### Create Stasis Application Dialplan

#### Method 1: Via FreePBX GUI

1. Navigate to **Admin → Config Edit**
2. Select `extensions_custom.conf`
3. Add:

```ini
[ai-bridge-context]
exten => 777,1,NoOp(=== AI Bridge Call ===)
 same => n,Answer()
 same => n,Wait(1)
 same => n,Stasis(ai-bridge,${CALLERID(num)})
 same => n,Hangup()
```

4. Save and Apply Config

#### Method 2: Include in from-internal

Add to **Custom Destinations** or edit `extensions_custom.conf`:

```ini
[from-internal-custom]
include => ai-bridge-context
```

Reload dialplan:
```bash
asterisk -rx "dialplan reload"
```

### Verify Configuration

#### Check Extensions

```bash
asterisk -rx "pjsip show endpoints" | grep -E "101|102"
```

Expected output:
```
 Endpoint:  101                                          Not in use    0 of inf
 Endpoint:  102                                          Not in use    0 of inf
```

#### Check AMI

```bash
asterisk -rx "manager show users"
```

#### Check ARI

```bash
asterisk -rx "ari show users"
asterisk -rx "ari show apps"
```

## Deliverables

### Screenshot Checklist

- [ ] FreePBX Dashboard showing both extensions "Online"
- [ ] AMI manager user configuration
- [ ] ARI user configuration
- [ ] Successful ARI API response

### Testing Extensions

1. Register SIP clients (e.g., Zoiper, Linphone) to extensions 101 and 102
2. Make a test call between extensions
3. Dial 777 to test AI bridge connection

## Troubleshooting

### Common Issues

**Extensions not registering:**
```bash
# Check PJSIP status
asterisk -rx "pjsip show registrations"
asterisk -rx "pjsip show contacts"

# Check firewall
ufw status
```

**AMI connection refused:**
```bash
# Verify AMI is enabled
asterisk -rx "manager show settings"

# Check if port is listening
netstat -tlnp | grep 5038
```

**ARI not responding:**
```bash
# Check HTTP server
asterisk -rx "http show status"

# Check port
netstat -tlnp | grep 8088
```

### Logs

```bash
# Asterisk full log
tail -f /var/log/asterisk/full

# FreePBX log
tail -f /var/log/asterisk/freepbx.log
```

## Security Hardening (Production)

1. **Change default passwords**
2. **Enable TLS for ARI:**
   ```ini
   # In http.conf
   tlsenable = yes
   tlsbindaddr = 0.0.0.0:8089
   tlscertfile = /etc/asterisk/keys/asterisk.pem
   ```
3. **Restrict AMI by IP**
4. **Enable fail2ban for Asterisk**
5. **Configure firewall rules**

## Next Steps

After completing this setup:

1. Configure your `.env` file with the AMI/ARI credentials
2. Run the AI-PBX Gateway: `npm start`
3. Test the complete pipeline by dialing 777
