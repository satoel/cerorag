config {
  call_module_type = "local"
}

# Bundled ruleset, no plugin download needed.
plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
