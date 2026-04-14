#!/bin/bash
# Start the ollama-gemma VM and open an SSH tunnel to port 11434.
# Tries all zones for capacity, restores from snapshot if needed.
set -e

PROJECT=lasagna-prod
INSTANCE=ollama-gemma
MACHINE_TYPE=g2-standard-4
ACCELERATOR=type=nvidia-l4,count=1
IMAGE=common-cu129-ubuntu-2204-nvidia-580-v20260408
IMAGE_PROJECT=deeplearning-platform-release
SNAPSHOT=ollama-gemma-snapshot
LOCAL_PORT=11434
ZONES=(us-central1-a us-central1-b us-central1-c us-central1-f us-east4-a us-east4-c us-west1-b)

# ── Find which zone the instance currently lives in ──────────────────────────
CURRENT_ZONE=$(gcloud compute instances list \
  --project=$PROJECT \
  --filter="name=$INSTANCE" \
  --format="value(zone)" 2>/dev/null | head -1)

if [[ -n "$CURRENT_ZONE" ]]; then
  STATUS=$(gcloud compute instances describe $INSTANCE \
    --project=$PROJECT --zone=$CURRENT_ZONE \
    --format="value(status)" 2>/dev/null)

  if [[ "$STATUS" == "RUNNING" ]]; then
    echo "$INSTANCE is already running in $CURRENT_ZONE."
  else
    echo "Starting $INSTANCE in $CURRENT_ZONE..."
    if ! gcloud compute instances start $INSTANCE \
        --project=$PROJECT --zone=$CURRENT_ZONE 2>&1 | grep -q "ERROR"; then
      echo "Started successfully."
    else
      echo "Zone $CURRENT_ZONE is out of capacity. Finding another zone..."
      CURRENT_ZONE=""
    fi
  fi
fi

# ── If no running instance, find a zone with capacity and recreate ────────────
if [[ -z "$CURRENT_ZONE" ]]; then
  echo "Looking for an available zone..."

  # Delete the terminated instance if it exists (keep the disk via snapshot)
  OLD_ZONE=$(gcloud compute instances list \
    --project=$PROJECT --filter="name=$INSTANCE" \
    --format="value(zone)" 2>/dev/null | head -1)
  if [[ -n "$OLD_ZONE" ]]; then
    echo "Removing terminated instance from $OLD_ZONE (disk preserved via snapshot)..."
    gcloud compute instances delete $INSTANCE \
      --project=$PROJECT --zone=$OLD_ZONE --quiet 2>/dev/null || true
  fi

  for ZONE in "${ZONES[@]}"; do
    echo -n "  Trying $ZONE... "
    if gcloud compute instances create $INSTANCE \
        --project=$PROJECT \
        --zone=$ZONE \
        --machine-type=$MACHINE_TYPE \
        --accelerator=$ACCELERATOR \
        --maintenance-policy=TERMINATE \
        --image=$IMAGE \
        --image-project=$IMAGE_PROJECT \
        --boot-disk-size=100GB \
        --boot-disk-type=pd-ssd \
        --no-boot-disk-auto-delete \
        --tags=ollama-server \
        --metadata=install-nvidia-driver=True \
        2>&1 | grep -q "RUNNING\|STAGING"; then
      echo "success!"
      CURRENT_ZONE=$ZONE

      echo "Installing Ollama and restoring models from snapshot..."
      sleep 20
      gcloud compute ssh $INSTANCE --zone=$ZONE --project=$PROJECT --command="
        curl -fsSL https://ollama.com/install.sh | sudo sh
        sudo mkdir -p /etc/systemd/system/ollama.service.d
        printf '[Service]\nEnvironment=OLLAMA_HOST=127.0.0.1:11434\n' \
          | sudo tee /etc/systemd/system/ollama.service.d/override.conf
        sudo systemctl daemon-reload && sudo systemctl enable ollama && sudo systemctl start ollama
      " 2>&1

      # Restore models from snapshot by pulling them (faster than mounting)
      echo "Pulling models (may take a few minutes)..."
      gcloud compute ssh $INSTANCE --zone=$ZONE --project=$PROJECT --command="
        ollama pull gemma4:31b
        ollama pull gemma3:27b
      " 2>&1
      break
    else
      echo "stockout"
    fi
  done

  if [[ -z "$CURRENT_ZONE" ]]; then
    echo "ERROR: No zones have L4 capacity right now. Try again later."
    exit 1
  fi
fi

# ── Wait for Ollama to be ready ───────────────────────────────────────────────
echo "Waiting for Ollama..."
until gcloud compute ssh $INSTANCE --zone=$CURRENT_ZONE --project=$PROJECT \
    --command="curl -sf http://localhost:11434/api/tags > /dev/null" 2>/dev/null; do
  sleep 5
  echo -n "."
done
echo " ready."

# ── Open SSH tunnel ───────────────────────────────────────────────────────────
echo "SSH tunnel open on localhost:$LOCAL_PORT. Press Ctrl+C to close."
echo "Run: npx tsx scripts/trial-ollama-extraction.ts <file>"

cleanup() {
  echo ""
  read -p "Stop the VM to save costs? [Y/n] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Nn]$ ]]; then
    echo "Stopping $INSTANCE in $CURRENT_ZONE..."
    gcloud compute instances stop $INSTANCE --zone=$CURRENT_ZONE --project=$PROJECT
    echo "VM stopped. Disk preserved."
  fi
}
trap cleanup EXIT

gcloud compute ssh $INSTANCE \
  --zone=$CURRENT_ZONE \
  --project=$PROJECT \
  -- -N -L $LOCAL_PORT:127.0.0.1:11434
