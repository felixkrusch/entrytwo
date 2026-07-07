Failing Git-Model tests indicate the core accounting engine's restore/balance logic is currently broken or the tests are stale — worth resolving first.
Heavy any usage will block a strict CI gate; lint debt is concentrated in lib/ helpers.
i18n foundation claims "100% externalized" but only en locale exists — no locale fallback coverage yet.