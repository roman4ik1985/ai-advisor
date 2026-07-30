output "service_name" {
  description = "Aiven service name. Connection credentials are intentionally not emitted."
  value       = aiven_valkey.ai_advisor.service_name
}

output "app_username" {
  description = "Restricted application ACL username."
  value       = aiven_valkey_user.ai_advisor.username
}

