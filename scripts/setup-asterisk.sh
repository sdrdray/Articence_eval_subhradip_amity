#!/bin/bash
#=====================================================
# FreePBX Setup Script for AI-PBX Gateway
# Run this script on your Debian 12 server after
# FreePBX installation to configure AMI/ARI
#=====================================================

set -e

echo "═══════════════════════════════════════════════════"
echo "  AI-PBX Gateway - Asterisk Configuration Setup"
echo "═══════════════════════════════════════════════════"

# Configuration - CHANGE THESE!
AMI_USER="ai-gateway"
AMI_PASSWORD="your_secure_ami_password"
ARI_USER="ai-bridge"
ARI_PASSWORD="your_secure_ari_password"

# Paths
ASTERISK_CONF_DIR="/etc/asterisk"
MANAGER_D_DIR="${ASTERISK_CONF_DIR}/manager.d"

echo ""
echo "📁 Creating configuration directories..."
mkdir -p "${MANAGER_D_DIR}"

echo ""
echo "📝 Configuring AMI (Manager Interface)..."
cat > "${MANAGER_D_DIR}/ai-gateway.conf" << EOF
[${AMI_USER}]
secret = ${AMI_PASSWORD}
deny = 0.0.0.0/0.0.0.0
permit = 127.0.0.1/255.255.255.255
read = system,call,log,verbose,command,agent,user,dtmf,originate,dialplan,cdr
write = system,call,log,verbose,command,agent,user,originate
EOF

echo "✅ AMI configuration created"

echo ""
echo "📝 Configuring ARI (REST Interface)..."
cat > "${ASTERISK_CONF_DIR}/ari.conf" << EOF
[general]
enabled = yes
pretty = yes
allowed_origins = *

[${ARI_USER}]
type = user
read_only = no
password = ${ARI_PASSWORD}
EOF

echo "✅ ARI configuration created"

echo ""
echo "📝 Configuring HTTP server..."
cat > "${ASTERISK_CONF_DIR}/http.conf" << EOF
[general]
enabled = yes
bindaddr = 0.0.0.0
bindport = 8088
EOF

echo "✅ HTTP configuration created"

echo ""
echo "📝 Adding Stasis dialplan..."
cat >> "${ASTERISK_CONF_DIR}/extensions_custom.conf" << EOF

[ai-bridge-context]
exten => 777,1,NoOp(=== AI Bridge Call from \${CALLERID(num)} ===)
 same => n,Answer()
 same => n,Wait(1)
 same => n,Stasis(ai-bridge,\${CALLERID(num)},\${UNIQUEID})
 same => n,Hangup()
EOF

echo "✅ Dialplan added"

echo ""
echo "🔄 Reloading Asterisk configuration..."
asterisk -rx "manager reload" || echo "Warning: manager reload failed"
asterisk -rx "module reload res_ari.so" || echo "Warning: ARI reload failed"
asterisk -rx "dialplan reload" || echo "Warning: dialplan reload failed"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Configuration Complete!"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  AMI User: ${AMI_USER}"
echo "  AMI Port: 5038"
echo ""
echo "  ARI User: ${ARI_USER}"
echo "  ARI Port: 8088"
echo ""
echo "  Stasis App: ai-bridge (dial 777)"
echo ""
echo "  Update your .env file with these credentials!"
echo "═══════════════════════════════════════════════════"

echo ""
echo "🔍 Testing connections..."
echo ""
echo "AMI Users:"
asterisk -rx "manager show users" | head -20

echo ""
echo "ARI Users:"
asterisk -rx "ari show users"

echo ""
echo "ARI Apps:"
asterisk -rx "ari show apps"

echo ""
echo "HTTP Status:"
asterisk -rx "http show status"
