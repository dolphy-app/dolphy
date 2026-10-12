SELECT name FROM pragma_table_info('account') WHERE "notnull" = 1 AND dflt_value IS NULL;
