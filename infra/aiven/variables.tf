variable "aiven_project" {
  description = "Existing Aiven project name."
  type        = string
}

variable "service_name" {
  description = "Stable Aiven service name."
  type        = string
  default     = "ai-advisor-valkey"
}

variable "plan" {
  description = "Aiven Valkey plan selected in the console. Use a two-node Business plan for production failover acceptance."
  type        = string
}

variable "cloud_name" {
  description = "Aiven cloud/region identifier available to the project. Free plans may require null."
  type        = string
  default     = null
  nullable    = true
}

variable "allowed_cidrs" {
  description = "Exact public egress CIDR blocks allowed to reach Valkey. Do not leave 0.0.0.0/0 in production."
  type        = set(string)

  validation {
    condition = (
      length(var.allowed_cidrs) > 0
      && !contains(var.allowed_cidrs, "0.0.0.0/0")
      && !contains(var.allowed_cidrs, "::/0")
    )
    error_message = "Supply at least one narrow runtime egress CIDR; world-open access is forbidden."
  }
}

variable "valkey_app_password" {
  description = "App ACL password. Supply through TF_VAR_valkey_app_password; never commit it."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.valkey_app_password) >= 32
    error_message = "The Valkey app password must contain at least 32 characters."
  }
}

variable "valkey_app_password_version" {
  description = "Increment to rotate the write-only app password."
  type        = number
  default     = 1
}

