# Aiven Valkey 9.1 deployment

This Terraform package declares the AI Advisor managed datastore without
activating Telegram order handling.

Prerequisites:

- Terraform 1.11 or newer;
- an existing Aiven account and project;
- `AIVEN_TOKEN` in the operator process environment;
- a selected Valkey plan and cloud identifier;
- the exact public egress CIDR of the active runtime;
- a 32+ character password supplied only as
  `TF_VAR_valkey_app_password`.

Safe workflow:

```powershell
Set-Location 'C:\AI Advisor\infra\aiven'
terraform init
terraform validate
terraform plan -out ai-advisor-valkey.tfplan
```

Review the plan before `terraform apply`. Applying a plan creates a managed
external resource and can create charges. Never commit `.terraform/`, a plan
file, state, tokens, passwords, or a connection URI.

Production acceptance requires a two-node Business plan. The free plan is
single-node and is suitable only for TLS, command, Lua, concurrency and RDB
compatibility evidence; it cannot prove primary/replica failover.

