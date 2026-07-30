terraform {
  required_version = ">= 1.11.0"

  required_providers {
    aiven = {
      source  = "aiven/aiven"
      version = "~> 4.60"
    }
  }
}

provider "aiven" {}

resource "aiven_valkey" "ai_advisor" {
  project                = var.aiven_project
  service_name           = var.service_name
  plan                   = var.plan
  cloud_name             = var.cloud_name
  termination_protection = true

  valkey_user_config {
    valkey_version          = "9.1"
    valkey_ssl              = true
    valkey_persistence      = "rdb"
    frequent_snapshots      = true
    valkey_maxmemory_policy = "noeviction"
    service_log             = true

    public_access {
      valkey = true
    }

    dynamic "ip_filter_object" {
      for_each = var.allowed_cidrs

      content {
        network     = ip_filter_object.value
        description = "AI Advisor runtime egress"
      }
    }
  }

  tag {
    key   = "application"
    value = "ai-advisor"
  }

  tag {
    key   = "feature"
    value = "telegram-order"
  }

  tag {
    key   = "activation"
    value = "disabled"
  }
}

resource "aiven_valkey_user" "ai_advisor" {
  project             = var.aiven_project
  service_name        = aiven_valkey.ai_advisor.service_name
  username            = "ai-advisor"
  password_wo         = var.valkey_app_password
  password_wo_version = var.valkey_app_password_version

  valkey_acl_categories = [
    "+@connection",
    "+@read",
    "+@scripting",
    "+@write",
  ]

  valkey_acl_commands = [
    "+info",
    "+ping",
    "-acl",
    "-config",
    "-flushall",
    "-flushdb",
    "-keys",
    "-module",
    "-shutdown",
  ]

  valkey_acl_keys = [
    "aiadvisor:*",
  ]
}

