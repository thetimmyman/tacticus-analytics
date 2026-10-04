export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      _ha_state: {
        Row: {
          key: string
          value: string | null
        }
        Insert: {
          key: string
          value?: string | null
        }
        Update: {
          key?: string
          value?: string | null
        }
        Relationships: []
      }
      ability_metadata: {
        Row: {
          ability_id: string
          display_name: string | null
          source_file: string | null
          updated_at: string
          web_icon_url: string | null
        }
        Insert: {
          ability_id: string
          display_name?: string | null
          source_file?: string | null
          updated_at?: string
          web_icon_url?: string | null
        }
        Update: {
          ability_id?: string
          display_name?: string | null
          source_file?: string | null
          updated_at?: string
          web_icon_url?: string | null
        }
        Relationships: []
      }
      assignment_runs: {
        Row: {
          assignments: Json
          created_at: string | null
          excluded_bosses: string[] | null
          generated_at: string | null
          generated_by: string | null
          guild_code: string
          id: string
          is_dry_run: boolean | null
          is_published: boolean | null
          max_tokens_per_player: number | null
          overrides_applied: Json | null
          published_at: string | null
          published_by: string | null
          season: string
          skip_side_bosses: boolean | null
          strategy: string | null
          updated_at: string | null
          warnings: string[] | null
        }
        Insert: {
          assignments?: Json
          created_at?: string | null
          excluded_bosses?: string[] | null
          generated_at?: string | null
          generated_by?: string | null
          guild_code: string
          id?: string
          is_dry_run?: boolean | null
          is_published?: boolean | null
          max_tokens_per_player?: number | null
          overrides_applied?: Json | null
          published_at?: string | null
          published_by?: string | null
          season: string
          skip_side_bosses?: boolean | null
          strategy?: string | null
          updated_at?: string | null
          warnings?: string[] | null
        }
        Update: {
          assignments?: Json
          created_at?: string | null
          excluded_bosses?: string[] | null
          generated_at?: string | null
          generated_by?: string | null
          guild_code?: string
          id?: string
          is_dry_run?: boolean | null
          is_published?: boolean | null
          max_tokens_per_player?: number | null
          overrides_applied?: Json | null
          published_at?: string | null
          published_by?: string | null
          season?: string
          skip_side_bosses?: boolean | null
          strategy?: string | null
          updated_at?: string | null
          warnings?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "assignment_runs_generated_by_fkey"
            columns: ["generated_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "assignment_runs_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "assignment_runs_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "assignment_runs_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "assignment_runs_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string | null
          created_at: string | null
          details: Json | null
          id: string
          ip_address: unknown
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      bomb_tracking: {
        Row: {
          cluster_code: string | null
          cluster_id: string | null
          created_at: string | null
          display_name: string
          guild: string
          id: number
          last_used: string | null
          player_id: string
          updated_at: string | null
        }
        Insert: {
          cluster_code?: string | null
          cluster_id?: string | null
          created_at?: string | null
          display_name: string
          guild: string
          id?: number
          last_used?: string | null
          player_id: string
          updated_at?: string | null
        }
        Update: {
          cluster_code?: string | null
          cluster_id?: string | null
          created_at?: string | null
          display_name?: string
          guild?: string
          id?: number
          last_used?: string | null
          player_id?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      boss_assignment_configs: {
        Row: {
          excluded_bosses: string[] | null
          guild_code: string
          max_tokens_per_boss: number | null
          max_tokens_per_player: number | null
          min_tokens_per_boss: number | null
          priority_groups: Json | null
          solver_weights: Json | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          excluded_bosses?: string[] | null
          guild_code: string
          max_tokens_per_boss?: number | null
          max_tokens_per_player?: number | null
          min_tokens_per_boss?: number | null
          priority_groups?: Json | null
          solver_weights?: Json | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          excluded_bosses?: string[] | null
          guild_code?: string
          max_tokens_per_boss?: number | null
          max_tokens_per_player?: number | null
          min_tokens_per_boss?: number | null
          priority_groups?: Json | null
          solver_weights?: Json | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boss_assignment_configs_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "boss_assignment_configs_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "boss_assignment_configs_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "boss_assignment_configs_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      boss_mapping: {
        Row: {
          asset_slug: string | null
          asset_source: string | null
          auto_generated: boolean | null
          avoid_traits: string[] | null
          base_armor: number | null
          base_damage: number | null
          base_health: number | null
          boss_name: string
          boss_type: string
          can_fly: boolean | null
          created_at: string | null
          damage_type: string | null
          encounter_index: number
          faction: string | null
          faction_ban: string | null
          hex_height: number | null
          hex_width: number | null
          icon_path: string | null
          id: number
          key_abilities: string[] | null
          last_synced_at: string | null
          map_display_name: string | null
          map_metadata: Json | null
          map_slug: string | null
          map_source: string | null
          map_variant: string | null
          movement: number | null
          portrait_path: string | null
          preferred_traits: string[] | null
          thumbnail_path: string | null
          traits: string[] | null
          unit_id: string | null
          updated_at: string | null
          weaknesses: string[] | null
        }
        Insert: {
          asset_slug?: string | null
          asset_source?: string | null
          auto_generated?: boolean | null
          avoid_traits?: string[] | null
          base_armor?: number | null
          base_damage?: number | null
          base_health?: number | null
          boss_name: string
          boss_type: string
          can_fly?: boolean | null
          created_at?: string | null
          damage_type?: string | null
          encounter_index: number
          faction?: string | null
          faction_ban?: string | null
          hex_height?: number | null
          hex_width?: number | null
          icon_path?: string | null
          id?: number
          key_abilities?: string[] | null
          last_synced_at?: string | null
          map_display_name?: string | null
          map_metadata?: Json | null
          map_slug?: string | null
          map_source?: string | null
          map_variant?: string | null
          movement?: number | null
          portrait_path?: string | null
          preferred_traits?: string[] | null
          thumbnail_path?: string | null
          traits?: string[] | null
          unit_id?: string | null
          updated_at?: string | null
          weaknesses?: string[] | null
        }
        Update: {
          asset_slug?: string | null
          asset_source?: string | null
          auto_generated?: boolean | null
          avoid_traits?: string[] | null
          base_armor?: number | null
          base_damage?: number | null
          base_health?: number | null
          boss_name?: string
          boss_type?: string
          can_fly?: boolean | null
          created_at?: string | null
          damage_type?: string | null
          encounter_index?: number
          faction?: string | null
          faction_ban?: string | null
          hex_height?: number | null
          hex_width?: number | null
          icon_path?: string | null
          id?: number
          key_abilities?: string[] | null
          last_synced_at?: string | null
          map_display_name?: string | null
          map_metadata?: Json | null
          map_slug?: string | null
          map_source?: string | null
          map_variant?: string | null
          movement?: number | null
          portrait_path?: string | null
          preferred_traits?: string[] | null
          thumbnail_path?: string | null
          traits?: string[] | null
          unit_id?: string | null
          updated_at?: string | null
          weaknesses?: string[] | null
        }
        Relationships: []
      }
      boss_name_aliases: {
        Row: {
          alias_name: string
          canonical_name: string
          created_at: string | null
          id: number
          notes: string | null
          unit_id: string | null
        }
        Insert: {
          alias_name: string
          canonical_name: string
          created_at?: string | null
          id?: number
          notes?: string | null
          unit_id?: string | null
        }
        Update: {
          alias_name?: string
          canonical_name?: string
          created_at?: string | null
          id?: number
          notes?: string | null
          unit_id?: string | null
        }
        Relationships: []
      }
      boss_playbook_history: {
        Row: {
          boss_id: string
          changed_at: string | null
          changed_by: string | null
          content: string
          id: string
          version: number
        }
        Insert: {
          boss_id: string
          changed_at?: string | null
          changed_by?: string | null
          content: string
          id?: string
          version: number
        }
        Update: {
          boss_id?: string
          changed_at?: string | null
          changed_by?: string | null
          content?: string
          id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "boss_playbook_history_boss_id_fkey"
            columns: ["boss_id"]
            isOneToOne: false
            referencedRelation: "boss_playbooks"
            referencedColumns: ["boss_id"]
          },
          {
            foreignKeyName: "boss_playbook_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      boss_playbook_tactics: {
        Row: {
          boss_id: string
          cluster_code: string | null
          content: string
          content_format: string | null
          contributor_id: string | null
          created_at: string | null
          encounter_type: string
          guild_code: string
          id: string
          is_featured: boolean | null
          map_slug: string | null
          meta_team_id: string | null
          rarity_set: string | null
          updated_at: string | null
          version: number | null
        }
        Insert: {
          boss_id: string
          cluster_code?: string | null
          content: string
          content_format?: string | null
          contributor_id?: string | null
          created_at?: string | null
          encounter_type: string
          guild_code: string
          id?: string
          is_featured?: boolean | null
          map_slug?: string | null
          meta_team_id?: string | null
          rarity_set?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Update: {
          boss_id?: string
          cluster_code?: string | null
          content?: string
          content_format?: string | null
          contributor_id?: string | null
          created_at?: string | null
          encounter_type?: string
          guild_code?: string
          id?: string
          is_featured?: boolean | null
          map_slug?: string | null
          meta_team_id?: string | null
          rarity_set?: string | null
          updated_at?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "boss_playbook_tactics_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "boss_playbook_tactics_meta_team_id_fkey"
            columns: ["meta_team_id"]
            isOneToOne: false
            referencedRelation: "meta_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      boss_playbook_tactics_history: {
        Row: {
          changed_at: string | null
          changed_by: string | null
          content: string
          content_format: string
          id: string
          tactics_id: string
          version: number
        }
        Insert: {
          changed_at?: string | null
          changed_by?: string | null
          content: string
          content_format: string
          id?: string
          tactics_id: string
          version: number
        }
        Update: {
          changed_at?: string | null
          changed_by?: string | null
          content?: string
          content_format?: string
          id?: string
          tactics_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "boss_playbook_tactics_history_changed_by_fkey"
            columns: ["changed_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "boss_playbook_tactics_history_tactics_id_fkey"
            columns: ["tactics_id"]
            isOneToOne: false
            referencedRelation: "boss_playbook_tactics"
            referencedColumns: ["id"]
          },
        ]
      }
      boss_playbook_team_requirements: {
        Row: {
          boss_id: string
          cluster_code: string | null
          contributor_id: string | null
          created_at: string | null
          difficulty: string | null
          guild_code: string | null
          hero_requirements: Json
          id: string
          is_verified: boolean | null
          meta_team_id: string | null
          overall_notes: string | null
          rarity_set: string | null
          team_name: string | null
          updated_at: string | null
        }
        Insert: {
          boss_id: string
          cluster_code?: string | null
          contributor_id?: string | null
          created_at?: string | null
          difficulty?: string | null
          guild_code?: string | null
          hero_requirements: Json
          id?: string
          is_verified?: boolean | null
          meta_team_id?: string | null
          overall_notes?: string | null
          rarity_set?: string | null
          team_name?: string | null
          updated_at?: string | null
        }
        Update: {
          boss_id?: string
          cluster_code?: string | null
          contributor_id?: string | null
          created_at?: string | null
          difficulty?: string | null
          guild_code?: string | null
          hero_requirements?: Json
          id?: string
          is_verified?: boolean | null
          meta_team_id?: string | null
          overall_notes?: string | null
          rarity_set?: string | null
          team_name?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boss_playbook_team_requirements_contributor_id_fkey"
            columns: ["contributor_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "boss_playbook_team_requirements_meta_team_id_fkey"
            columns: ["meta_team_id"]
            isOneToOne: false
            referencedRelation: "meta_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      boss_playbooks: {
        Row: {
          boss_id: string
          content: string
          updated_at: string | null
          updated_by: string | null
          version: number | null
        }
        Insert: {
          boss_id: string
          content: string
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
        }
        Update: {
          boss_id?: string
          content?: string
          updated_at?: string | null
          updated_by?: string | null
          version?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "boss_playbooks_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      boss_target_tokens: {
        Row: {
          board_id: string | null
          boss_name: string
          encounter_id: number
          guild_code: string
          notes: string | null
          rarity: string
          season_number: string
          seeded_from_seasons: string | null
          set: number
          skip: boolean
          source: string
          target_tokens: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          board_id?: string | null
          boss_name: string
          encounter_id?: number
          guild_code: string
          notes?: string | null
          rarity: string
          season_number?: string
          seeded_from_seasons?: string | null
          set: number
          skip?: boolean
          source: string
          target_tokens: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          board_id?: string | null
          boss_name?: string
          encounter_id?: number
          guild_code?: string
          notes?: string | null
          rarity?: string
          season_number?: string
          seeded_from_seasons?: string | null
          set?: number
          skip?: boolean
          source?: string
          target_tokens?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boss_target_tokens_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "boss_target_tokens_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "boss_target_tokens_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "boss_target_tokens_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      boss_tiers: {
        Row: {
          ability_level: number
          armor: number
          boss_mapping_id: number | null
          crit_chance: number | null
          crit_damage: number | null
          damage: number
          health: number
          id: number
          tier_index: number
          tier_name: string
        }
        Insert: {
          ability_level?: number
          armor: number
          boss_mapping_id?: number | null
          crit_chance?: number | null
          crit_damage?: number | null
          damage: number
          health: number
          id?: number
          tier_index: number
          tier_name: string
        }
        Update: {
          ability_level?: number
          armor?: number
          boss_mapping_id?: number | null
          crit_chance?: number | null
          crit_damage?: number | null
          damage?: number
          health?: number
          id?: number
          tier_index?: number
          tier_name?: string
        }
        Relationships: [
          {
            foreignKeyName: "boss_tiers_boss_mapping_id_fkey"
            columns: ["boss_mapping_id"]
            isOneToOne: false
            referencedRelation: "boss_identifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boss_tiers_boss_mapping_id_fkey"
            columns: ["boss_mapping_id"]
            isOneToOne: false
            referencedRelation: "boss_mapping"
            referencedColumns: ["id"]
          },
        ]
      }
      carousel_items: {
        Row: {
          accent_color: string | null
          background_color: string | null
          created_at: string | null
          created_by: string | null
          description: string | null
          expires_at: string | null
          id: string
          image_url: string | null
          is_active: boolean | null
          item_type: string
          link_text: string | null
          link_url: string | null
          priority: number | null
          promo_code: string | null
          starts_at: string | null
          text_color: string | null
          title: string
          updated_at: string | null
        }
        Insert: {
          accent_color?: string | null
          background_color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          item_type?: string
          link_text?: string | null
          link_url?: string | null
          priority?: number | null
          promo_code?: string | null
          starts_at?: string | null
          text_color?: string | null
          title: string
          updated_at?: string | null
        }
        Update: {
          accent_color?: string | null
          background_color?: string | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          expires_at?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean | null
          item_type?: string
          link_text?: string | null
          link_url?: string | null
          priority?: number | null
          promo_code?: string | null
          starts_at?: string | null
          text_color?: string | null
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "carousel_items_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      cluster_rankings_refresh_state: {
        Row: {
          last_refreshed_at: string
          singleton: boolean
        }
        Insert: {
          last_refreshed_at: string
          singleton?: boolean
        }
        Update: {
          last_refreshed_at?: string
          singleton?: boolean
        }
        Relationships: []
      }
      clusters: {
        Row: {
          accent_color: string | null
          banner_url: string | null
          cluster_code: string
          cluster_stats: Json | null
          created_at: string | null
          created_by: string | null
          description: string | null
          discord_invite_url: string | null
          discord_server_id: string | null
          display_name: string | null
          feature_flags: Json | null
          founded_date: string | null
          founder_name: string | null
          id: string
          invite_code: string | null
          invite_expires_at: string | null
          is_active: boolean | null
          is_public: boolean | null
          logo_url: string | null
          max_guilds: number | null
          onboarding_completed: boolean | null
          onboarding_started_at: string | null
          primary_color: string | null
          primary_language: string | null
          public_notes: string | null
          secondary_color: string | null
          short_name: string | null
          tagline: string | null
          time_zone: string | null
          updated_at: string | null
          website_url: string | null
        }
        Insert: {
          accent_color?: string | null
          banner_url?: string | null
          cluster_code: string
          cluster_stats?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          discord_invite_url?: string | null
          discord_server_id?: string | null
          display_name?: string | null
          feature_flags?: Json | null
          founded_date?: string | null
          founder_name?: string | null
          id?: string
          invite_code?: string | null
          invite_expires_at?: string | null
          is_active?: boolean | null
          is_public?: boolean | null
          logo_url?: string | null
          max_guilds?: number | null
          onboarding_completed?: boolean | null
          onboarding_started_at?: string | null
          primary_color?: string | null
          primary_language?: string | null
          public_notes?: string | null
          secondary_color?: string | null
          short_name?: string | null
          tagline?: string | null
          time_zone?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Update: {
          accent_color?: string | null
          banner_url?: string | null
          cluster_code?: string
          cluster_stats?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string | null
          discord_invite_url?: string | null
          discord_server_id?: string | null
          display_name?: string | null
          feature_flags?: Json | null
          founded_date?: string | null
          founder_name?: string | null
          id?: string
          invite_code?: string | null
          invite_expires_at?: string | null
          is_active?: boolean | null
          is_public?: boolean | null
          logo_url?: string | null
          max_guilds?: number | null
          onboarding_completed?: boolean | null
          onboarding_started_at?: string | null
          primary_color?: string | null
          primary_language?: string | null
          public_notes?: string | null
          secondary_color?: string | null
          short_name?: string | null
          tagline?: string | null
          time_zone?: string | null
          updated_at?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clusters_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      coaching_task_deliveries: {
        Row: {
          actor_user_id: string | null
          completed_at: string | null
          consent_id: string
          created_at: string
          destination_id: string
          error_code: string | null
          expires_at: string
          guild_code: string
          id: string
          payload_sha256: string
          provider_status: number | null
          request_id: string
          status: string
          subject_user_id: string
          task_id: string
        }
        Insert: {
          actor_user_id?: string | null
          completed_at?: string | null
          consent_id: string
          created_at?: string
          destination_id: string
          error_code?: string | null
          expires_at?: string
          guild_code: string
          id?: string
          payload_sha256: string
          provider_status?: number | null
          request_id: string
          status?: string
          subject_user_id: string
          task_id: string
        }
        Update: {
          actor_user_id?: string | null
          completed_at?: string | null
          consent_id?: string
          created_at?: string
          destination_id?: string
          error_code?: string | null
          expires_at?: string
          guild_code?: string
          id?: string
          payload_sha256?: string
          provider_status?: number | null
          request_id?: string
          status?: string
          subject_user_id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coaching_task_deliveries_actor_user_id_fkey"
            columns: ["actor_user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "coaching_task_deliveries_consent_id_fkey"
            columns: ["consent_id"]
            isOneToOne: false
            referencedRelation: "gdpr_user_consent"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_task_deliveries_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "webhook_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_task_deliveries_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "coaching_task_deliveries_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "coaching_task_deliveries_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "coaching_task_deliveries_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "coaching_task_deliveries_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "coaching_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      coaching_task_delivery_dedup: {
        Row: {
          delivered_at: string
          destination_id: string
          payload_sha256: string
          task_id: string
        }
        Insert: {
          delivered_at?: string
          destination_id: string
          payload_sha256: string
          task_id: string
        }
        Update: {
          delivered_at?: string
          destination_id?: string
          payload_sha256?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "coaching_task_delivery_dedup_destination_id_fkey"
            columns: ["destination_id"]
            isOneToOne: false
            referencedRelation: "webhook_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coaching_task_delivery_dedup_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "coaching_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      coaching_task_delivery_rate_buckets: {
        Row: {
          delivery_count: number
          scope_class: string
          scope_key: string
          updated_at: string
          window_class: string
          window_start: string
        }
        Insert: {
          delivery_count?: number
          scope_class: string
          scope_key: string
          updated_at?: string
          window_class: string
          window_start: string
        }
        Update: {
          delivery_count?: number
          scope_class?: string
          scope_key?: string
          updated_at?: string
          window_class?: string
          window_start?: string
        }
        Relationships: []
      }
      coaching_tasks: {
        Row: {
          boss_type: string
          classification: string
          confidence: string
          created_at: string
          created_by: string | null
          display_name: string
          encounter_index: number
          guild_code: string
          id: string
          original_actual_avg: number | null
          rarity_set: string | null
          ready_now_upside: number | null
          recommended_swaps: Json
          recommended_team_hash: string
          resolution: string | null
          resolved_at: string | null
          season: string
          snooze_request_id: string | null
          snoozed_until: string | null
          source_battle_count: number
          status: string
          subject_user_id: string | null
          updated_at: string
          used_team_hash: string
        }
        Insert: {
          boss_type: string
          classification: string
          confidence: string
          created_at?: string
          created_by?: string | null
          display_name: string
          encounter_index: number
          guild_code: string
          id?: string
          original_actual_avg?: number | null
          rarity_set?: string | null
          ready_now_upside?: number | null
          recommended_swaps?: Json
          recommended_team_hash: string
          resolution?: string | null
          resolved_at?: string | null
          season: string
          snooze_request_id?: string | null
          snoozed_until?: string | null
          source_battle_count: number
          status?: string
          subject_user_id?: string | null
          updated_at?: string
          used_team_hash: string
        }
        Update: {
          boss_type?: string
          classification?: string
          confidence?: string
          created_at?: string
          created_by?: string | null
          display_name?: string
          encounter_index?: number
          guild_code?: string
          id?: string
          original_actual_avg?: number | null
          rarity_set?: string | null
          ready_now_upside?: number | null
          recommended_swaps?: Json
          recommended_team_hash?: string
          resolution?: string | null
          resolved_at?: string | null
          season?: string
          snooze_request_id?: string | null
          snoozed_until?: string | null
          source_battle_count?: number
          status?: string
          subject_user_id?: string | null
          updated_at?: string
          used_team_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "coaching_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "coaching_tasks_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "coaching_tasks_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "coaching_tasks_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "coaching_tasks_subject_user_id_fkey"
            columns: ["subject_user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      discord_channel_guilds: {
        Row: {
          cluster_code: string | null
          created_at: string
          created_by: string | null
          default_for_notifications: boolean
          default_for_tokens: boolean
          discord_channel_id: string
          discord_guild_id: string
          game_guild_code: string
          id: string
        }
        Insert: {
          cluster_code?: string | null
          created_at?: string
          created_by?: string | null
          default_for_notifications?: boolean
          default_for_tokens?: boolean
          discord_channel_id: string
          discord_guild_id: string
          game_guild_code: string
          id?: string
        }
        Update: {
          cluster_code?: string | null
          created_at?: string
          created_by?: string | null
          default_for_notifications?: boolean
          default_for_tokens?: boolean
          discord_channel_id?: string
          discord_guild_id?: string
          game_guild_code?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "discord_channel_guilds_game_guild_code_fkey"
            columns: ["game_guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "discord_channel_guilds_game_guild_code_fkey"
            columns: ["game_guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "discord_channel_guilds_game_guild_code_fkey"
            columns: ["game_guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      discord_invite_codes: {
        Row: {
          cluster_code: string | null
          created_at: string | null
          created_by: string | null
          current_uses: number | null
          expires_at: string | null
          guild_code: string | null
          id: number
          invite_code: string
          invite_scope: string
          is_active: boolean | null
          max_uses: number | null
        }
        Insert: {
          cluster_code?: string | null
          created_at?: string | null
          created_by?: string | null
          current_uses?: number | null
          expires_at?: string | null
          guild_code?: string | null
          id?: never
          invite_code?: string
          invite_scope?: string
          is_active?: boolean | null
          max_uses?: number | null
        }
        Update: {
          cluster_code?: string | null
          created_at?: string | null
          created_by?: string | null
          current_uses?: number | null
          expires_at?: string | null
          guild_code?: string | null
          id?: never
          invite_code?: string
          invite_scope?: string
          is_active?: boolean | null
          max_uses?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "discord_invite_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "discord_invite_codes_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "discord_invite_codes_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "discord_invite_codes_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      discord_message_tracking: {
        Row: {
          boss_key: string
          cluster_code: string | null
          content_hash: string | null
          content_updated_at: string | null
          created_at: string | null
          guild_code: string
          id: number
          message_id: string
          season: string
          top_player: string | null
          top_score: number | null
          updated_at: string | null
          webhook_url: string
        }
        Insert: {
          boss_key: string
          cluster_code?: string | null
          content_hash?: string | null
          content_updated_at?: string | null
          created_at?: string | null
          guild_code: string
          id?: number
          message_id: string
          season: string
          top_player?: string | null
          top_score?: number | null
          updated_at?: string | null
          webhook_url: string
        }
        Update: {
          boss_key?: string
          cluster_code?: string | null
          content_hash?: string | null
          content_updated_at?: string | null
          created_at?: string | null
          guild_code?: string
          id?: number
          message_id?: string
          season?: string
          top_player?: string | null
          top_score?: number | null
          updated_at?: string | null
          webhook_url?: string
        }
        Relationships: []
      }
      discord_server_guilds: {
        Row: {
          cluster_code: string | null
          discord_guild_id: string
          game_guild_code: string
          id: number
          invited_with_code: string | null
          is_active: boolean | null
          linked_at: string | null
          linked_by_user_id: string | null
        }
        Insert: {
          cluster_code?: string | null
          discord_guild_id: string
          game_guild_code: string
          id?: never
          invited_with_code?: string | null
          is_active?: boolean | null
          linked_at?: string | null
          linked_by_user_id?: string | null
        }
        Update: {
          cluster_code?: string | null
          discord_guild_id?: string
          game_guild_code?: string
          id?: never
          invited_with_code?: string | null
          is_active?: boolean | null
          linked_at?: string | null
          linked_by_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discord_server_mappings_game_guild_code_fkey"
            columns: ["game_guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "discord_server_mappings_game_guild_code_fkey"
            columns: ["game_guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "discord_server_mappings_game_guild_code_fkey"
            columns: ["game_guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "discord_server_mappings_invited_with_code_fkey"
            columns: ["invited_with_code"]
            isOneToOne: false
            referencedRelation: "discord_invite_codes"
            referencedColumns: ["invite_code"]
          },
        ]
      }
      discord_token_reminders: {
        Row: {
          channel_id: string | null
          cluster_code: string | null
          created_at: string
          discord_guild_id: string
          enabled: boolean
          game_guild_code: string
          id: string
          last_notified_at: string | null
          updated_at: string
        }
        Insert: {
          channel_id?: string | null
          cluster_code?: string | null
          created_at?: string
          discord_guild_id: string
          enabled?: boolean
          game_guild_code: string
          id?: string
          last_notified_at?: string | null
          updated_at?: string
        }
        Update: {
          channel_id?: string | null
          cluster_code?: string | null
          created_at?: string
          discord_guild_id?: string
          enabled?: boolean
          game_guild_code?: string
          id?: string
          last_notified_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discord_token_reminders_game_guild_fk"
            columns: ["game_guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "discord_token_reminders_game_guild_fk"
            columns: ["game_guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "discord_token_reminders_game_guild_fk"
            columns: ["game_guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      discord_user_guild_defaults: {
        Row: {
          cluster_code: string | null
          created_at: string
          discord_guild_id: string
          discord_user_id: string
          game_guild_code: string
          id: string
          updated_at: string
        }
        Insert: {
          cluster_code?: string | null
          created_at?: string
          discord_guild_id: string
          discord_user_id: string
          game_guild_code: string
          id?: string
          updated_at?: string
        }
        Update: {
          cluster_code?: string | null
          created_at?: string
          discord_guild_id?: string
          discord_user_id?: string
          game_guild_code?: string
          id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discord_user_guild_defaults_game_guild_code_fkey"
            columns: ["game_guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "discord_user_guild_defaults_game_guild_code_fkey"
            columns: ["game_guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "discord_user_guild_defaults_game_guild_code_fkey"
            columns: ["game_guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      discord_user_permissions: {
        Row: {
          cluster_code: string | null
          discord_user_id: string
          expires_at: string | null
          game_guild_code: string
          id: number
          role: string
          verified_at: string | null
        }
        Insert: {
          cluster_code?: string | null
          discord_user_id: string
          expires_at?: string | null
          game_guild_code: string
          id?: never
          role: string
          verified_at?: string | null
        }
        Update: {
          cluster_code?: string | null
          discord_user_id?: string
          expires_at?: string | null
          game_guild_code?: string
          id?: never
          role?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      discord_webhook_logs: {
        Row: {
          created_at: string | null
          delivered_at: string | null
          error_message: string | null
          guild_code: string
          id: string
          manual_override: boolean
          mentioned_roles: Json | null
          payload_preview: string | null
          retry_count: number | null
          status: string
          suppressed_by_master_toggle: boolean
          threshold_breach_type: string | null
          webhook_type: string
          webhook_url_hash: string
        }
        Insert: {
          created_at?: string | null
          delivered_at?: string | null
          error_message?: string | null
          guild_code: string
          id?: string
          manual_override?: boolean
          mentioned_roles?: Json | null
          payload_preview?: string | null
          retry_count?: number | null
          status: string
          suppressed_by_master_toggle?: boolean
          threshold_breach_type?: string | null
          webhook_type: string
          webhook_url_hash: string
        }
        Update: {
          created_at?: string | null
          delivered_at?: string | null
          error_message?: string | null
          guild_code?: string
          id?: string
          manual_override?: boolean
          mentioned_roles?: Json | null
          payload_preview?: string | null
          retry_count?: number | null
          status?: string
          suppressed_by_master_toggle?: boolean
          threshold_breach_type?: string | null
          webhook_type?: string
          webhook_url_hash?: string
        }
        Relationships: []
      }
      EOT_GR_data: {
        Row: {
          cluster_code: string | null
          cluster_id: string | null
          completedOn: string | null
          damageDealt: number | null
          damageType: string | null
          displayName: string | null
          encounterId: number
          encounterIndex: number
          encounterType: string | null
          globalConfigHash: string | null
          Guild: string
          heroDetails: string | null
          id: number
          loopIndex: number | null
          machineOfWarDetails: string | null
          maxHp: number | null
          Name: string | null
          rarity: string | null
          remainingHp: number | null
          Season: string | null
          season_num: number | null
          set: number | null
          startedOn: string | null
          tier: number | null
          timestamp: string | null
          type: string | null
          unitId: string | null
          userId: string | null
        }
        Insert: {
          cluster_code?: string | null
          cluster_id?: string | null
          completedOn?: string | null
          damageDealt?: number | null
          damageType?: string | null
          displayName?: string | null
          encounterId: number
          encounterIndex?: number
          encounterType?: string | null
          globalConfigHash?: string | null
          Guild: string
          heroDetails?: string | null
          id?: number
          loopIndex?: number | null
          machineOfWarDetails?: string | null
          maxHp?: number | null
          Name?: string | null
          rarity?: string | null
          remainingHp?: number | null
          Season?: string | null
          season_num?: number | null
          set?: number | null
          startedOn?: string | null
          tier?: number | null
          timestamp?: string | null
          type?: string | null
          unitId?: string | null
          userId?: string | null
        }
        Update: {
          cluster_code?: string | null
          cluster_id?: string | null
          completedOn?: string | null
          damageDealt?: number | null
          damageType?: string | null
          displayName?: string | null
          encounterId?: number
          encounterIndex?: number
          encounterType?: string | null
          globalConfigHash?: string | null
          Guild?: string
          heroDetails?: string | null
          id?: number
          loopIndex?: number | null
          machineOfWarDetails?: string | null
          maxHp?: number | null
          Name?: string | null
          rarity?: string | null
          remainingHp?: number | null
          Season?: string | null
          season_num?: number | null
          set?: number | null
          startedOn?: string | null
          tier?: number | null
          timestamp?: string | null
          type?: string | null
          unitId?: string | null
          userId?: string | null
        }
        Relationships: []
      }
      execution_locks: {
        Row: {
          acquired_at: string | null
          expires_at: string
          guild_code: string | null
          heartbeat_at: string | null
          lock_id: string
          lock_key: string
          worker_id: string
        }
        Insert: {
          acquired_at?: string | null
          expires_at: string
          guild_code?: string | null
          heartbeat_at?: string | null
          lock_id?: string
          lock_key: string
          worker_id: string
        }
        Update: {
          acquired_at?: string | null
          expires_at?: string
          guild_code?: string | null
          heartbeat_at?: string | null
          lock_id?: string
          lock_key?: string
          worker_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_locks_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "execution_locks_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "execution_locks_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      feature_access_grants: {
        Row: {
          access_level: string
          expires_at: string | null
          granted_at: string
          granted_by: string | null
          id: string
          notes: string | null
          user_id: string
        }
        Insert: {
          access_level: string
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          notes?: string | null
          user_id: string
        }
        Update: {
          access_level?: string
          expires_at?: string | null
          granted_at?: string
          granted_by?: string | null
          id?: string
          notes?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feature_access_grants_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "feature_access_grants_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      feature_releases: {
        Row: {
          created_at: string
          description: string | null
          display_name: string
          feature_key: string
          icon: string | null
          id: string
          release_stage: string
          released_at: string | null
          route: string | null
          sort_order: number | null
          updated_at: string
          value_proposition: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          display_name: string
          feature_key: string
          icon?: string | null
          id?: string
          release_stage?: string
          released_at?: string | null
          route?: string | null
          sort_order?: number | null
          updated_at?: string
          value_proposition?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          display_name?: string
          feature_key?: string
          icon?: string | null
          id?: string
          release_stage?: string
          released_at?: string | null
          route?: string | null
          sort_order?: number | null
          updated_at?: string
          value_proposition?: string | null
        }
        Relationships: []
      }
      function_locks: {
        Row: {
          created_at: string
          lock_id: string
          lock_key: string
          locked_at: string
          locked_until: string
        }
        Insert: {
          created_at?: string
          lock_id: string
          lock_key: string
          locked_at?: string
          locked_until: string
        }
        Update: {
          created_at?: string
          lock_id?: string
          lock_key?: string
          locked_at?: string
          locked_until?: string
        }
        Relationships: []
      }
      gdpr_data_exports: {
        Row: {
          completed_at: string | null
          created_at: string | null
          data_package: Json | null
          download_url: string | null
          expires_at: string | null
          processing_started_at: string | null
          request_id: string
          requested_at: string | null
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          data_package?: Json | null
          download_url?: string | null
          expires_at?: string | null
          processing_started_at?: string | null
          request_id?: string
          requested_at?: string | null
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          data_package?: Json | null
          download_url?: string | null
          expires_at?: string | null
          processing_started_at?: string | null
          request_id?: string
          requested_at?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      gdpr_deletion_requests: {
        Row: {
          completed_at: string | null
          created_at: string | null
          data_categories: string[] | null
          request_id: string
          request_type: string
          requested_at: string | null
          scheduled_for: string
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          data_categories?: string[] | null
          request_id?: string
          request_type: string
          requested_at?: string | null
          scheduled_for: string
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          data_categories?: string[] | null
          request_id?: string
          request_type?: string
          requested_at?: string | null
          scheduled_for?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      gdpr_processing_log: {
        Row: {
          consent_given: boolean | null
          created_at: string | null
          data_type: string
          id: string
          legal_basis: string
          processing_purpose: string
          retention_until: string | null
          timestamp: string | null
          user_id: string
        }
        Insert: {
          consent_given?: boolean | null
          created_at?: string | null
          data_type: string
          id?: string
          legal_basis: string
          processing_purpose: string
          retention_until?: string | null
          timestamp?: string | null
          user_id: string
        }
        Update: {
          consent_given?: boolean | null
          created_at?: string | null
          data_type?: string
          id?: string
          legal_basis?: string
          processing_purpose?: string
          retention_until?: string | null
          timestamp?: string | null
          user_id?: string
        }
        Relationships: []
      }
      gdpr_user_consent: {
        Row: {
          consent_given: boolean
          consent_timestamp: string | null
          consent_type: string
          consent_version: string | null
          created_at: string | null
          id: string
          ip_address: unknown
          user_agent: string | null
          user_id: string
          withdrawn_at: string | null
        }
        Insert: {
          consent_given: boolean
          consent_timestamp?: string | null
          consent_type: string
          consent_version?: string | null
          created_at?: string | null
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id: string
          withdrawn_at?: string | null
        }
        Update: {
          consent_given?: boolean
          consent_timestamp?: string | null
          consent_type?: string
          consent_version?: string | null
          created_at?: string | null
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string
          withdrawn_at?: string | null
        }
        Relationships: []
      }
      global_strength_thresholds: {
        Row: {
          created_at: string | null
          id: string
          min_ability_active: number | null
          min_ability_passive: number | null
          min_rank: string
          min_rank_index: number
          notes: string | null
          rarity: string
          strength_level: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          min_ability_active?: number | null
          min_ability_passive?: number | null
          min_rank: string
          min_rank_index: number
          notes?: string | null
          rarity: string
          strength_level: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          min_ability_active?: number | null
          min_ability_passive?: number | null
          min_rank?: string
          min_rank_index?: number
          notes?: string | null
          rarity?: string
          strength_level?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      guild_api_incident_notification_state: {
        Row: {
          created_at: string
          guild_code: string
          incident_last_seen_at: string | null
          incident_started_at: string | null
          incident_type: string | null
          last_notification_error: string | null
          notified_at: string | null
          notified_recipient_count: number
          notified_recipients: Json
          resolved_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          guild_code: string
          incident_last_seen_at?: string | null
          incident_started_at?: string | null
          incident_type?: string | null
          last_notification_error?: string | null
          notified_at?: string | null
          notified_recipient_count?: number
          notified_recipients?: Json
          resolved_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          guild_code?: string
          incident_last_seen_at?: string | null
          incident_started_at?: string | null
          incident_type?: string | null
          last_notification_error?: string | null
          notified_at?: string | null
          notified_recipient_count?: number
          notified_recipients?: Json
          resolved_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_api_incident_notification_state_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_api_incident_notification_state_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_api_incident_notification_state_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      guild_boss_season_rotation: {
        Row: {
          current_bosses: Json
          current_config_id: string
          error_reason: string | null
          id: string
          matches: number
          next_bosses: Json
          next_config_id: string
          notes: string | null
          observed_bosses: Json
          resolved_at: string
          season_number: number | null
          source: string
        }
        Insert: {
          current_bosses: Json
          current_config_id: string
          error_reason?: string | null
          id?: string
          matches?: number
          next_bosses: Json
          next_config_id: string
          notes?: string | null
          observed_bosses?: Json
          resolved_at?: string
          season_number?: number | null
          source?: string
        }
        Update: {
          current_bosses?: Json
          current_config_id?: string
          error_reason?: string | null
          id?: string
          matches?: number
          next_bosses?: Json
          next_config_id?: string
          notes?: string | null
          observed_bosses?: Json
          resolved_at?: string
          season_number?: number | null
          source?: string
        }
        Relationships: []
      }
      guild_code_legacy_map: {
        Row: {
          canonical_guild_code: string
          captured_at: string | null
          legacy_guild_code: string
        }
        Insert: {
          canonical_guild_code: string
          captured_at?: string | null
          legacy_guild_code: string
        }
        Update: {
          canonical_guild_code?: string
          captured_at?: string | null
          legacy_guild_code?: string
        }
        Relationships: []
      }
      guild_config: {
        Row: {
          api_key_encrypted: string | null
          api_key_is_valid: boolean | null
          api_key_last_validated: string | null
          api_key_migration_status: string | null
          API_Owner: string | null
          apply_token_offender_filtering: boolean
          auto_sync_enabled: boolean | null
          banner_url: string | null
          beta_tester: boolean
          bomb_alert_calculation_mode: string
          bomb_alert_enabled: boolean
          bomb_alert_overkill_threshold: number
          bomb_alert_ping_holders: boolean
          bomb_alert_role_id: string | null
          bomb_alert_webhook_url: string | null
          cluster_code: string | null
          cluster_id: string | null
          cluster_role: string | null
          combine_prime_deaths: boolean
          compact_availability_posts: boolean
          consecutive_loki_failures: number
          consecutive_sync_failures: number | null
          contact_discord: string | null
          created_at: string | null
          defeat_alerts_enabled: boolean
          description: string | null
          discord_webhook_enabled: boolean | null
          discord_webhook_url: string | null
          display_name: string
          enabled: boolean | null
          explore_obfuscation_percent: number
          explore_privacy_mode: Json
          GR_Ranking: number | null
          guild_code: string
          guild_id: string | null
          guild_level: number | null
          guild_level_overridden_at: string | null
          guild_tag: string | null
          GW_Ranking: number | null
          herald_default_role_id: string | null
          id: number
          is_cluster: boolean | null
          joined_cluster_at: string | null
          last_raid_write_at: string | null
          last_resume_attempt_at: string | null
          last_roster_refresh_at: string | null
          last_successful_gw_season: number | null
          last_successful_sync: string | null
          last_sync_attempt: string | null
          logo_url: string | null
          mention_roles_as_text: boolean
          min_account_level: number | null
          min_power_level: number | null
          notifications_enabled: boolean
          onboarding_completed: boolean | null
          onboarding_completed_at: string | null
          onboarding_source: string | null
          onboarding_started_at: string | null
          preferred_languages: string[] | null
          preferred_timezone: string | null
          primary_assignment_tokens: number | null
          realtime_sync: boolean
          registration_completed_at: string | null
          registration_started_at: string | null
          registration_status: string | null
          requirements_text: string | null
          restrict_playbooks_to_assignments: boolean | null
          secondary_assignment_tokens: number | null
          session_id: string | null
          session_refreshed_at: string | null
          short_code: string | null
          social_links: Json | null
          sync_tier: string
          tagline: string | null
          theme_preset: string | null
          timezone: string | null
          token_abuser_threshold: number | null
          token_offender_threshold: number | null
          updated_at: string | null
          use_modular_sync: boolean
          user_id: string | null
          war_visibility: string
        }
        Insert: {
          api_key_encrypted?: string | null
          api_key_is_valid?: boolean | null
          api_key_last_validated?: string | null
          api_key_migration_status?: string | null
          API_Owner?: string | null
          apply_token_offender_filtering?: boolean
          auto_sync_enabled?: boolean | null
          banner_url?: string | null
          beta_tester?: boolean
          bomb_alert_calculation_mode?: string
          bomb_alert_enabled?: boolean
          bomb_alert_overkill_threshold?: number
          bomb_alert_ping_holders?: boolean
          bomb_alert_role_id?: string | null
          bomb_alert_webhook_url?: string | null
          cluster_code?: string | null
          cluster_id?: string | null
          cluster_role?: string | null
          combine_prime_deaths?: boolean
          compact_availability_posts?: boolean
          consecutive_loki_failures?: number
          consecutive_sync_failures?: number | null
          contact_discord?: string | null
          created_at?: string | null
          defeat_alerts_enabled?: boolean
          description?: string | null
          discord_webhook_enabled?: boolean | null
          discord_webhook_url?: string | null
          display_name: string
          enabled?: boolean | null
          explore_obfuscation_percent?: number
          explore_privacy_mode?: Json
          GR_Ranking?: number | null
          guild_code: string
          guild_id?: string | null
          guild_level?: number | null
          guild_level_overridden_at?: string | null
          guild_tag?: string | null
          GW_Ranking?: number | null
          herald_default_role_id?: string | null
          id?: number
          is_cluster?: boolean | null
          joined_cluster_at?: string | null
          last_raid_write_at?: string | null
          last_resume_attempt_at?: string | null
          last_roster_refresh_at?: string | null
          last_successful_gw_season?: number | null
          last_successful_sync?: string | null
          last_sync_attempt?: string | null
          logo_url?: string | null
          mention_roles_as_text?: boolean
          min_account_level?: number | null
          min_power_level?: number | null
          notifications_enabled?: boolean
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          onboarding_source?: string | null
          onboarding_started_at?: string | null
          preferred_languages?: string[] | null
          preferred_timezone?: string | null
          primary_assignment_tokens?: number | null
          realtime_sync?: boolean
          registration_completed_at?: string | null
          registration_started_at?: string | null
          registration_status?: string | null
          requirements_text?: string | null
          restrict_playbooks_to_assignments?: boolean | null
          secondary_assignment_tokens?: number | null
          session_id?: string | null
          session_refreshed_at?: string | null
          short_code?: string | null
          social_links?: Json | null
          sync_tier?: string
          tagline?: string | null
          theme_preset?: string | null
          timezone?: string | null
          token_abuser_threshold?: number | null
          token_offender_threshold?: number | null
          updated_at?: string | null
          use_modular_sync?: boolean
          user_id?: string | null
          war_visibility?: string
        }
        Update: {
          api_key_encrypted?: string | null
          api_key_is_valid?: boolean | null
          api_key_last_validated?: string | null
          api_key_migration_status?: string | null
          API_Owner?: string | null
          apply_token_offender_filtering?: boolean
          auto_sync_enabled?: boolean | null
          banner_url?: string | null
          beta_tester?: boolean
          bomb_alert_calculation_mode?: string
          bomb_alert_enabled?: boolean
          bomb_alert_overkill_threshold?: number
          bomb_alert_ping_holders?: boolean
          bomb_alert_role_id?: string | null
          bomb_alert_webhook_url?: string | null
          cluster_code?: string | null
          cluster_id?: string | null
          cluster_role?: string | null
          combine_prime_deaths?: boolean
          compact_availability_posts?: boolean
          consecutive_loki_failures?: number
          consecutive_sync_failures?: number | null
          contact_discord?: string | null
          created_at?: string | null
          defeat_alerts_enabled?: boolean
          description?: string | null
          discord_webhook_enabled?: boolean | null
          discord_webhook_url?: string | null
          display_name?: string
          enabled?: boolean | null
          explore_obfuscation_percent?: number
          explore_privacy_mode?: Json
          GR_Ranking?: number | null
          guild_code?: string
          guild_id?: string | null
          guild_level?: number | null
          guild_level_overridden_at?: string | null
          guild_tag?: string | null
          GW_Ranking?: number | null
          herald_default_role_id?: string | null
          id?: number
          is_cluster?: boolean | null
          joined_cluster_at?: string | null
          last_raid_write_at?: string | null
          last_resume_attempt_at?: string | null
          last_roster_refresh_at?: string | null
          last_successful_gw_season?: number | null
          last_successful_sync?: string | null
          last_sync_attempt?: string | null
          logo_url?: string | null
          mention_roles_as_text?: boolean
          min_account_level?: number | null
          min_power_level?: number | null
          notifications_enabled?: boolean
          onboarding_completed?: boolean | null
          onboarding_completed_at?: string | null
          onboarding_source?: string | null
          onboarding_started_at?: string | null
          preferred_languages?: string[] | null
          preferred_timezone?: string | null
          primary_assignment_tokens?: number | null
          realtime_sync?: boolean
          registration_completed_at?: string | null
          registration_started_at?: string | null
          registration_status?: string | null
          requirements_text?: string | null
          restrict_playbooks_to_assignments?: boolean | null
          secondary_assignment_tokens?: number | null
          session_id?: string | null
          session_refreshed_at?: string | null
          short_code?: string | null
          social_links?: Json | null
          sync_tier?: string
          tagline?: string | null
          theme_preset?: string | null
          timezone?: string | null
          token_abuser_threshold?: number | null
          token_offender_threshold?: number | null
          updated_at?: string | null
          use_modular_sync?: boolean
          user_id?: string | null
          war_visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "fk_guild_cluster"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "cluster_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_guild_cluster"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "clusters"
            referencedColumns: ["id"]
          },
        ]
      }
      guild_historical_backfill_history: {
        Row: {
          created_at: string | null
          error_message: string | null
          final_season_count: number | null
          guild_code: string
          has_minimum_history: boolean | null
          id: number
          processing_time_ms: number | null
          records_inserted: number | null
          seasons_added: number | null
          status: string
        }
        Insert: {
          created_at?: string | null
          error_message?: string | null
          final_season_count?: number | null
          guild_code: string
          has_minimum_history?: boolean | null
          id?: number
          processing_time_ms?: number | null
          records_inserted?: number | null
          seasons_added?: number | null
          status: string
        }
        Update: {
          created_at?: string | null
          error_message?: string | null
          final_season_count?: number | null
          guild_code?: string
          has_minimum_history?: boolean | null
          id?: number
          processing_time_ms?: number | null
          records_inserted?: number | null
          seasons_added?: number | null
          status?: string
        }
        Relationships: []
      }
      guild_historical_backfill_status: {
        Row: {
          created_at: string | null
          current_season_count: number | null
          error_message: string | null
          guild_code: string
          has_minimum_history: boolean | null
          last_attempt: string | null
          priority: number
          processing_started_at: string | null
          queue_status: string
          seasons_added: number | null
          seasons_needed: number | null
          status: string
          total_inserted: number | null
          updated_at: string | null
          worker_id: string | null
        }
        Insert: {
          created_at?: string | null
          current_season_count?: number | null
          error_message?: string | null
          guild_code: string
          has_minimum_history?: boolean | null
          last_attempt?: string | null
          priority?: number
          processing_started_at?: string | null
          queue_status?: string
          seasons_added?: number | null
          seasons_needed?: number | null
          status?: string
          total_inserted?: number | null
          updated_at?: string | null
          worker_id?: string | null
        }
        Update: {
          created_at?: string | null
          current_season_count?: number | null
          error_message?: string | null
          guild_code?: string
          has_minimum_history?: boolean | null
          last_attempt?: string | null
          priority?: number
          processing_started_at?: string | null
          queue_status?: string
          seasons_added?: number | null
          seasons_needed?: number | null
          status?: string
          total_inserted?: number | null
          updated_at?: string | null
          worker_id?: string | null
        }
        Relationships: []
      }
      guild_raid_boss_difficulty: {
        Row: {
          max_health: number
          rarity: Database["public"]["Enums"]["raid_rarity"]
          set_number: number
          unit_id: string
        }
        Insert: {
          max_health: number
          rarity: Database["public"]["Enums"]["raid_rarity"]
          set_number: number
          unit_id: string
        }
        Update: {
          max_health?: number
          rarity?: Database["public"]["Enums"]["raid_rarity"]
          set_number?: number
          unit_id?: string
        }
        Relationships: []
      }
      guild_raid_season_plan_assignments: {
        Row: {
          bombs: number
          created_at: string
          expected_bomb_damage: number | null
          expected_damage: number | null
          id: string
          plan_id: string
          player_id: string
          session_at: string
          target_label: string
          target_uid: string
          tokens: number
          updated_at: string
        }
        Insert: {
          bombs?: number
          created_at?: string
          expected_bomb_damage?: number | null
          expected_damage?: number | null
          id?: string
          plan_id: string
          player_id: string
          session_at: string
          target_label: string
          target_uid: string
          tokens?: number
          updated_at?: string
        }
        Update: {
          bombs?: number
          created_at?: string
          expected_bomb_damage?: number | null
          expected_damage?: number | null
          id?: string
          plan_id?: string
          player_id?: string
          session_at?: string
          target_label?: string
          target_uid?: string
          tokens?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_raid_season_plan_assignments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "guild_raid_season_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      guild_raid_season_plan_sessions: {
        Row: {
          bombs_available: number | null
          bombs_spend: number | null
          created_at: string
          id: string
          p_online: number
          plan_id: string
          player_id: string
          session_at: string
          tokens_available: number | null
          tokens_hold: number | null
          tokens_spend: number | null
          updated_at: string
        }
        Insert: {
          bombs_available?: number | null
          bombs_spend?: number | null
          created_at?: string
          id?: string
          p_online?: number
          plan_id: string
          player_id: string
          session_at: string
          tokens_available?: number | null
          tokens_hold?: number | null
          tokens_spend?: number | null
          updated_at?: string
        }
        Update: {
          bombs_available?: number | null
          bombs_spend?: number | null
          created_at?: string
          id?: string
          p_online?: number
          plan_id?: string
          player_id?: string
          session_at?: string
          tokens_available?: number | null
          tokens_hold?: number | null
          tokens_spend?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_raid_season_plan_sessions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "guild_raid_season_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      guild_raid_season_plans: {
        Row: {
          baseline_key: string | null
          baseline_plan_id: string | null
          created_at: string
          created_by: string | null
          end_at: string
          guild_code: string
          id: string
          input_snapshots: Json
          kind: string
          plan: Json
          plan_hash: string | null
          plan_metrics: Json
          resolved_options: Json
          season_id: string
          seed: number | null
          snapshot_at: string | null
          start_at: string
          trigger: string
          updated_at: string
        }
        Insert: {
          baseline_key?: string | null
          baseline_plan_id?: string | null
          created_at?: string
          created_by?: string | null
          end_at: string
          guild_code: string
          id?: string
          input_snapshots?: Json
          kind: string
          plan?: Json
          plan_hash?: string | null
          plan_metrics?: Json
          resolved_options?: Json
          season_id: string
          seed?: number | null
          snapshot_at?: string | null
          start_at: string
          trigger?: string
          updated_at?: string
        }
        Update: {
          baseline_key?: string | null
          baseline_plan_id?: string | null
          created_at?: string
          created_by?: string | null
          end_at?: string
          guild_code?: string
          id?: string
          input_snapshots?: Json
          kind?: string
          plan?: Json
          plan_hash?: string | null
          plan_metrics?: Json
          resolved_options?: Json
          season_id?: string
          seed?: number | null
          snapshot_at?: string | null
          start_at?: string
          trigger?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_raid_season_plans_baseline_plan_id_fkey"
            columns: ["baseline_plan_id"]
            isOneToOne: false
            referencedRelation: "guild_raid_season_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guild_raid_season_plans_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "guild_raid_season_plans_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_raid_season_plans_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_raid_season_plans_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      guild_roster_scoring_config: {
        Row: {
          auto_role_assign_enabled: boolean
          auto_role_assign_tier: string
          guild_code: string
          primary_source: string
          strength_target_rarity_set: string | null
          tier_optimal_pct: number
          tier_strong_pct: number
          tier_suitable_pct: number
          updated_at: string
        }
        Insert: {
          auto_role_assign_enabled?: boolean
          auto_role_assign_tier?: string
          guild_code: string
          primary_source?: string
          strength_target_rarity_set?: string | null
          tier_optimal_pct?: number
          tier_strong_pct?: number
          tier_suitable_pct?: number
          updated_at?: string
        }
        Update: {
          auto_role_assign_enabled?: boolean
          auto_role_assign_tier?: string
          guild_code?: string
          primary_source?: string
          strength_target_rarity_set?: string | null
          tier_optimal_pct?: number
          tier_strong_pct?: number
          tier_suitable_pct?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_roster_scoring_config_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_roster_scoring_config_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_roster_scoring_config_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      guild_sync_history: {
        Row: {
          battles_synced: number | null
          error_message: string | null
          guild_code: string
          id: number
          processing_time_ms: number | null
          status: string
          sync_type: string
          synced_at: string | null
        }
        Insert: {
          battles_synced?: number | null
          error_message?: string | null
          guild_code: string
          id?: number
          processing_time_ms?: number | null
          status: string
          sync_type: string
          synced_at?: string | null
        }
        Update: {
          battles_synced?: number | null
          error_message?: string | null
          guild_code?: string
          id?: number
          processing_time_ms?: number | null
          status?: string
          sync_type?: string
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guild_sync_history_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_sync_history_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_sync_history_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      guild_sync_status: {
        Row: {
          battle_count: number | null
          created_at: string | null
          error_message: string | null
          full_sync_at: string | null
          full_sync_success: boolean | null
          guild_code: string
          last_error: string | null
          last_sync: string | null
          member_count: number | null
          priority: number | null
          processing_started_at: string | null
          qstash_message_id: string | null
          queue_status: string | null
          quick_sync_at: string | null
          quick_sync_success: boolean | null
          records_synced: number | null
          status: string | null
          updated_at: string | null
          worker_id: string | null
        }
        Insert: {
          battle_count?: number | null
          created_at?: string | null
          error_message?: string | null
          full_sync_at?: string | null
          full_sync_success?: boolean | null
          guild_code: string
          last_error?: string | null
          last_sync?: string | null
          member_count?: number | null
          priority?: number | null
          processing_started_at?: string | null
          qstash_message_id?: string | null
          queue_status?: string | null
          quick_sync_at?: string | null
          quick_sync_success?: boolean | null
          records_synced?: number | null
          status?: string | null
          updated_at?: string | null
          worker_id?: string | null
        }
        Update: {
          battle_count?: number | null
          created_at?: string | null
          error_message?: string | null
          full_sync_at?: string | null
          full_sync_success?: boolean | null
          guild_code?: string
          last_error?: string | null
          last_sync?: string | null
          member_count?: number | null
          priority?: number | null
          processing_started_at?: string | null
          qstash_message_id?: string | null
          queue_status?: string | null
          quick_sync_at?: string | null
          quick_sync_success?: boolean | null
          records_synced?: number | null
          status?: string | null
          updated_at?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guild_sync_status_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_sync_status_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_sync_status_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      guild_themes: {
        Row: {
          accent_color: string
          bg_from: string
          bg_to: string
          bg_via: string
          card_bg: string
          card_border: string
          created_at: string | null
          guild_code: string
          id: number
          primary_color: string
          secondary_color: string
          text_accent: string
          text_primary: string
          text_secondary: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          accent_color?: string
          bg_from?: string
          bg_to?: string
          bg_via?: string
          card_bg?: string
          card_border?: string
          created_at?: string | null
          guild_code: string
          id?: number
          primary_color?: string
          secondary_color?: string
          text_accent?: string
          text_primary?: string
          text_secondary?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          accent_color?: string
          bg_from?: string
          bg_to?: string
          bg_via?: string
          card_bg?: string
          card_border?: string
          created_at?: string | null
          guild_code?: string
          id?: number
          primary_color?: string
          secondary_color?: string
          text_accent?: string
          text_primary?: string
          text_secondary?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guild_themes_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_themes_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_themes_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_themes_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      guild_war_battles: {
        Row: {
          attacker_guild_name: string | null
          attacker_lineup_id: string | null
          attacker_player_id: string | null
          attacker_player_name: string | null
          attacker_team_index: number | null
          attacker_units_json: Json | null
          attacker_units_lost: number | null
          attempt_debuff: number | null
          attempt_end_time: string | null
          attempt_number: number | null
          attempt_result: string | null
          attempt_start_time: string | null
          attempt_status: string | null
          battle_duration: number | null
          battle_summary: Json | null
          buffs: Json | null
          created_at: string | null
          damage_dealt: number | null
          defender_guild_name: string | null
          defender_lineup_id: string | null
          defender_player_id: string | null
          defender_player_name: string | null
          defender_units_json: Json | null
          defender_units_lost: number | null
          event_id: string | null
          failed_hit: boolean | null
          guild_code: string
          id: string
          is_guild_member: boolean | null
          kill_count: number | null
          perfect_hit: boolean | null
          raw_loki_data: Json | null
          score_earned: number | null
          units_used: Json | null
          updated_at: string | null
          war_id: string
          zone_id: string | null
          zone_type: string | null
        }
        Insert: {
          attacker_guild_name?: string | null
          attacker_lineup_id?: string | null
          attacker_player_id?: string | null
          attacker_player_name?: string | null
          attacker_team_index?: number | null
          attacker_units_json?: Json | null
          attacker_units_lost?: number | null
          attempt_debuff?: number | null
          attempt_end_time?: string | null
          attempt_number?: number | null
          attempt_result?: string | null
          attempt_start_time?: string | null
          attempt_status?: string | null
          battle_duration?: number | null
          battle_summary?: Json | null
          buffs?: Json | null
          created_at?: string | null
          damage_dealt?: number | null
          defender_guild_name?: string | null
          defender_lineup_id?: string | null
          defender_player_id?: string | null
          defender_player_name?: string | null
          defender_units_json?: Json | null
          defender_units_lost?: number | null
          event_id?: string | null
          failed_hit?: boolean | null
          guild_code: string
          id?: string
          is_guild_member?: boolean | null
          kill_count?: number | null
          perfect_hit?: boolean | null
          raw_loki_data?: Json | null
          score_earned?: number | null
          units_used?: Json | null
          updated_at?: string | null
          war_id: string
          zone_id?: string | null
          zone_type?: string | null
        }
        Update: {
          attacker_guild_name?: string | null
          attacker_lineup_id?: string | null
          attacker_player_id?: string | null
          attacker_player_name?: string | null
          attacker_team_index?: number | null
          attacker_units_json?: Json | null
          attacker_units_lost?: number | null
          attempt_debuff?: number | null
          attempt_end_time?: string | null
          attempt_number?: number | null
          attempt_result?: string | null
          attempt_start_time?: string | null
          attempt_status?: string | null
          battle_duration?: number | null
          battle_summary?: Json | null
          buffs?: Json | null
          created_at?: string | null
          damage_dealt?: number | null
          defender_guild_name?: string | null
          defender_lineup_id?: string | null
          defender_player_id?: string | null
          defender_player_name?: string | null
          defender_units_json?: Json | null
          defender_units_lost?: number | null
          event_id?: string | null
          failed_hit?: boolean | null
          guild_code?: string
          id?: string
          is_guild_member?: boolean | null
          kill_count?: number | null
          perfect_hit?: boolean | null
          raw_loki_data?: Json | null
          score_earned?: number | null
          units_used?: Json | null
          updated_at?: string | null
          war_id?: string
          zone_id?: string | null
          zone_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guild_war_battles_war_id_guild_code_fkey"
            columns: ["war_id", "guild_code"]
            isOneToOne: false
            referencedRelation: "guild_war_matches"
            referencedColumns: ["war_id", "guild_code"]
          },
          {
            foreignKeyName: "guild_war_battles_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "guild_war_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      guild_war_defensive_lineups: {
        Row: {
          created_at: string | null
          created_by: string | null
          guild_code: string
          id: string
          is_active: boolean | null
          lineup_name: string
          lineup_notes: string | null
          updated_at: string | null
          zone_assignments: Json
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          guild_code: string
          id?: string
          is_active?: boolean | null
          lineup_name: string
          lineup_notes?: string | null
          updated_at?: string | null
          zone_assignments: Json
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          guild_code?: string
          id?: string
          is_active?: boolean | null
          lineup_name?: string
          lineup_notes?: string | null
          updated_at?: string | null
          zone_assignments?: Json
        }
        Relationships: [
          {
            foreignKeyName: "guild_war_defensive_lineups_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_war_defensive_lineups_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_war_defensive_lineups_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      guild_war_leaderboards: {
        Row: {
          best_win_streak: number | null
          created_at: string | null
          current_rank: number | null
          current_streak: number | null
          guild_code: string
          id: string
          last_updated: string | null
          previous_rank: number | null
          rating: number | null
          raw_loki_data: Json | null
          season_end_date: string | null
          season_start_date: string | null
          streak_type: string | null
          total_score: number | null
          war_season: number
          wars_drawn: number | null
          wars_lost: number | null
          wars_played: number | null
          wars_won: number | null
          win_rate: number | null
        }
        Insert: {
          best_win_streak?: number | null
          created_at?: string | null
          current_rank?: number | null
          current_streak?: number | null
          guild_code: string
          id?: string
          last_updated?: string | null
          previous_rank?: number | null
          rating?: number | null
          raw_loki_data?: Json | null
          season_end_date?: string | null
          season_start_date?: string | null
          streak_type?: string | null
          total_score?: number | null
          war_season: number
          wars_drawn?: number | null
          wars_lost?: number | null
          wars_played?: number | null
          wars_won?: number | null
          win_rate?: number | null
        }
        Update: {
          best_win_streak?: number | null
          created_at?: string | null
          current_rank?: number | null
          current_streak?: number | null
          guild_code?: string
          id?: string
          last_updated?: string | null
          previous_rank?: number | null
          rating?: number | null
          raw_loki_data?: Json | null
          season_end_date?: string | null
          season_start_date?: string | null
          streak_type?: string | null
          total_score?: number | null
          war_season?: number
          wars_drawn?: number | null
          wars_lost?: number | null
          wars_played?: number | null
          wars_won?: number | null
          win_rate?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "guild_war_leaderboards_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_war_leaderboards_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_war_leaderboards_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      guild_war_lineups: {
        Row: {
          created_at: string | null
          hash_version: number
          lineup_id: string
          machine_of_war: Json | null
          units_json: Json
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          hash_version?: number
          lineup_id: string
          machine_of_war?: Json | null
          units_json: Json
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          hash_version?: number
          lineup_id?: string
          machine_of_war?: Json | null
          units_json?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      guild_war_matches: {
        Row: {
          battlefield_level: number | null
          created_at: string | null
          guild_code: string
          guild_score: number | null
          id: string
          opponent_guild_code: string | null
          opponent_guild_id: string | null
          opponent_guild_name: string
          opponent_guild_name_source: string
          opponent_is_unknown: boolean
          opponent_score: number | null
          raw_loki_data: Json | null
          updated_at: string | null
          war_end_date: string | null
          war_id: string
          war_result: string | null
          war_season: number | null
          war_start_date: string | null
          war_status: string
        }
        Insert: {
          battlefield_level?: number | null
          created_at?: string | null
          guild_code: string
          guild_score?: number | null
          id?: string
          opponent_guild_code?: string | null
          opponent_guild_id?: string | null
          opponent_guild_name?: string
          opponent_guild_name_source?: string
          opponent_is_unknown?: boolean
          opponent_score?: number | null
          raw_loki_data?: Json | null
          updated_at?: string | null
          war_end_date?: string | null
          war_id: string
          war_result?: string | null
          war_season?: number | null
          war_start_date?: string | null
          war_status: string
        }
        Update: {
          battlefield_level?: number | null
          created_at?: string | null
          guild_code?: string
          guild_score?: number | null
          id?: string
          opponent_guild_code?: string | null
          opponent_guild_id?: string | null
          opponent_guild_name?: string
          opponent_guild_name_source?: string
          opponent_is_unknown?: boolean
          opponent_score?: number | null
          raw_loki_data?: Json | null
          updated_at?: string | null
          war_end_date?: string | null
          war_id?: string
          war_result?: string | null
          war_season?: number | null
          war_start_date?: string | null
          war_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_war_matches_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_war_matches_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_war_matches_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      guild_war_meta_teams: {
        Row: {
          created_at: string
          created_by: string | null
          guild_code: string
          heroes: Json
          id: string
          name: string
          notes: string | null
          priority: number | null
          side: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          guild_code: string
          heroes?: Json
          id?: string
          name: string
          notes?: string | null
          priority?: number | null
          side: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          guild_code?: string
          heroes?: Json
          id?: string
          name?: string
          notes?: string | null
          priority?: number | null
          side?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_war_meta_teams_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      guild_war_participation: {
        Row: {
          attempts_remaining: number | null
          attempts_used: number | null
          claimed_power_level: number | null
          created_at: string | null
          display_name: string | null
          exhausted_units: number | null
          guild_code: string
          id: string
          last_activity_on: string | null
          opted_in: boolean | null
          opted_in_observed: boolean
          raw_loki_data: Json | null
          role: string | null
          score: number | null
          snapshot_at: string | null
          total_attempts_left: number | null
          total_units: number | null
          updated_at: string | null
          user_id: string
          war_id: string
        }
        Insert: {
          attempts_remaining?: number | null
          attempts_used?: number | null
          claimed_power_level?: number | null
          created_at?: string | null
          display_name?: string | null
          exhausted_units?: number | null
          guild_code: string
          id?: string
          last_activity_on?: string | null
          opted_in?: boolean | null
          opted_in_observed?: boolean
          raw_loki_data?: Json | null
          role?: string | null
          score?: number | null
          snapshot_at?: string | null
          total_attempts_left?: number | null
          total_units?: number | null
          updated_at?: string | null
          user_id: string
          war_id: string
        }
        Update: {
          attempts_remaining?: number | null
          attempts_used?: number | null
          claimed_power_level?: number | null
          created_at?: string | null
          display_name?: string | null
          exhausted_units?: number | null
          guild_code?: string
          id?: string
          last_activity_on?: string | null
          opted_in?: boolean | null
          opted_in_observed?: boolean
          raw_loki_data?: Json | null
          role?: string | null
          score?: number | null
          snapshot_at?: string | null
          total_attempts_left?: number | null
          total_units?: number | null
          updated_at?: string | null
          user_id?: string
          war_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_war_participation_war_id_guild_code_fkey"
            columns: ["war_id", "guild_code"]
            isOneToOne: false
            referencedRelation: "guild_war_matches"
            referencedColumns: ["war_id", "guild_code"]
          },
        ]
      }
      guild_war_player_attempts: {
        Row: {
          event_id: string | null
          attacker_guild_name: string | null
          attacker_team_index: number | null
          attacker_units_json: Json | null
          attempt_debuff: number | null
          attempt_end_time: string | null
          attempt_number: number
          attempt_result: string | null
          attempt_start_time: string | null
          attempt_status: string
          battle_duration: number | null
          created_at: string | null
          damage_dealt: number | null
          defender_guild_name: string | null
          defender_player_id: string | null
          defender_player_name: string | null
          defender_units_json: Json | null
          guild_code: string
          id: string
          is_guild_member: boolean
          player_id: string
          player_name: string
          raw_loki_data: Json | null
          score_earned: number | null
          units_used: Json | null
          updated_at: string | null
          war_id: string
          zone_id: string
        }
        Insert: {
          event_id?: string | null
          attacker_guild_name?: string | null
          attacker_team_index?: number | null
          attacker_units_json?: Json | null
          attempt_debuff?: number | null
          attempt_end_time?: string | null
          attempt_number: number
          attempt_result?: string | null
          attempt_start_time?: string | null
          attempt_status: string
          battle_duration?: number | null
          created_at?: string | null
          damage_dealt?: number | null
          defender_guild_name?: string | null
          defender_player_id?: string | null
          defender_player_name?: string | null
          defender_units_json?: Json | null
          guild_code: string
          id?: string
          is_guild_member?: boolean
          player_id: string
          player_name: string
          raw_loki_data?: Json | null
          score_earned?: number | null
          units_used?: Json | null
          updated_at?: string | null
          war_id: string
          zone_id: string
        }
        Update: {
          event_id?: string | null
          attacker_guild_name?: string | null
          attacker_team_index?: number | null
          attacker_units_json?: Json | null
          attempt_debuff?: number | null
          attempt_end_time?: string | null
          attempt_number?: number
          attempt_result?: string | null
          attempt_start_time?: string | null
          attempt_status?: string
          battle_duration?: number | null
          created_at?: string | null
          damage_dealt?: number | null
          defender_guild_name?: string | null
          defender_player_id?: string | null
          defender_player_name?: string | null
          defender_units_json?: Json | null
          guild_code?: string
          id?: string
          is_guild_member?: boolean
          player_id?: string
          player_name?: string
          raw_loki_data?: Json | null
          score_earned?: number | null
          units_used?: Json | null
          updated_at?: string | null
          war_id?: string
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_war_player_attempts_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "guild_war_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      guild_war_settings: {
        Row: {
          auto_opt_in: boolean | null
          auto_pick_battlefield_level: boolean | null
          created_at: string | null
          defensive_lineup_auto: boolean | null
          guild_code: string
          id: string
          officer_assignments: Json | null
          preferred_battlefield_level: number | null
          strategy_notes: string | null
          updated_at: string | null
          war_notifications_enabled: boolean | null
        }
        Insert: {
          auto_opt_in?: boolean | null
          auto_pick_battlefield_level?: boolean | null
          created_at?: string | null
          defensive_lineup_auto?: boolean | null
          guild_code: string
          id?: string
          officer_assignments?: Json | null
          preferred_battlefield_level?: number | null
          strategy_notes?: string | null
          updated_at?: string | null
          war_notifications_enabled?: boolean | null
        }
        Update: {
          auto_opt_in?: boolean | null
          auto_pick_battlefield_level?: boolean | null
          created_at?: string | null
          defensive_lineup_auto?: boolean | null
          guild_code?: string
          id?: string
          officer_assignments?: Json | null
          preferred_battlefield_level?: number | null
          strategy_notes?: string | null
          updated_at?: string | null
          war_notifications_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "guild_war_settings_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_war_settings_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_war_settings_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      guild_war_visibility_audit: {
        Row: {
          actor: string | null
          actor_db_role: string | null
          at: string
          guild_code: string
          id: number
          new_visibility: string
          old_visibility: string | null
        }
        Insert: {
          actor?: string | null
          actor_db_role?: string | null
          at?: string
          guild_code: string
          id?: never
          new_visibility: string
          old_visibility?: string | null
        }
        Update: {
          actor?: string | null
          actor_db_role?: string | null
          at?: string
          guild_code?: string
          id?: never
          new_visibility?: string
          old_visibility?: string | null
        }
        Relationships: []
      }
      guild_war_zone_assignment_entries: {
        Row: {
          assigned_at: string | null
          assignment_source: string
          created_at: string | null
          guild_code: string
          id: string
          player_id: string | null
          player_name: string
          updated_at: string | null
          war_id: string | null
          war_zone_id: string | null
          zone_id: string
        }
        Insert: {
          assigned_at?: string | null
          assignment_source: string
          created_at?: string | null
          guild_code: string
          id?: string
          player_id?: string | null
          player_name: string
          updated_at?: string | null
          war_id?: string | null
          war_zone_id?: string | null
          zone_id: string
        }
        Update: {
          assigned_at?: string | null
          assignment_source?: string
          created_at?: string | null
          guild_code?: string
          id?: string
          player_id?: string | null
          player_name?: string
          updated_at?: string | null
          war_id?: string | null
          war_zone_id?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_war_zone_assignment_entries_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_war_zone_assignment_entries_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_war_zone_assignment_entries_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      guild_war_zone_assignments: {
        Row: {
          assigned_players: string[] | null
          created_at: string | null
          guild_code: string
          id: string
          updated_at: string | null
          zone_id: string
        }
        Insert: {
          assigned_players?: string[] | null
          created_at?: string | null
          guild_code: string
          id?: string
          updated_at?: string | null
          zone_id: string
        }
        Update: {
          assigned_players?: string[] | null
          created_at?: string | null
          guild_code?: string
          id?: string
          updated_at?: string | null
          zone_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "guild_war_zone_assignments_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_war_zone_assignments_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "guild_war_zone_assignments_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      guild_war_zone_events: {
        Row: {
          created_at: string | null
          created_on: string | null
          event_type: string
          guild_code: string
          id: string
          raw_loki_data: Json | null
          updated_at: string | null
          user_id: string | null
          war_id: string
          zone_id: string | null
        }
        Insert: {
          created_at?: string | null
          created_on?: string | null
          event_type: string
          guild_code: string
          id?: string
          raw_loki_data?: Json | null
          updated_at?: string | null
          user_id?: string | null
          war_id: string
          zone_id?: string | null
        }
        Update: {
          created_at?: string | null
          created_on?: string | null
          event_type?: string
          guild_code?: string
          id?: string
          raw_loki_data?: Json | null
          updated_at?: string | null
          user_id?: string | null
          war_id?: string
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guild_war_zone_events_war_id_guild_code_fkey"
            columns: ["war_id", "guild_code"]
            isOneToOne: false
            referencedRelation: "guild_war_matches"
            referencedColumns: ["war_id", "guild_code"]
          },
          {
            foreignKeyName: "guild_war_zone_events_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "guild_war_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      guild_war_zones: {
        Row: {
          assigned_players: string[] | null
          attempts_remaining: number | null
          board_id: string | null
          created_at: string | null
          guild_code: string
          id: string
          max_attempts: number | null
          opponent_zone_score: number | null
          raw_loki_data: Json | null
          updated_at: string | null
          war_id: string
          zone_end_time: string | null
          zone_name: string | null
          zone_number: number
          zone_result: string | null
          zone_score: number | null
          zone_start_time: string | null
          zone_status: string
          zone_type: string
        }
        Insert: {
          assigned_players?: string[] | null
          attempts_remaining?: number | null
          board_id?: string | null
          created_at?: string | null
          guild_code: string
          id?: string
          max_attempts?: number | null
          opponent_zone_score?: number | null
          raw_loki_data?: Json | null
          updated_at?: string | null
          war_id: string
          zone_end_time?: string | null
          zone_name?: string | null
          zone_number: number
          zone_result?: string | null
          zone_score?: number | null
          zone_start_time?: string | null
          zone_status: string
          zone_type: string
        }
        Update: {
          assigned_players?: string[] | null
          attempts_remaining?: number | null
          board_id?: string | null
          created_at?: string | null
          guild_code?: string
          id?: string
          max_attempts?: number | null
          opponent_zone_score?: number | null
          raw_loki_data?: Json | null
          updated_at?: string | null
          war_id?: string
          zone_end_time?: string | null
          zone_name?: string | null
          zone_number?: number
          zone_result?: string | null
          zone_score?: number | null
          zone_start_time?: string | null
          zone_status?: string
          zone_type?: string
        }
        Relationships: []
      }
      herald_boss_availability: {
        Row: {
          boss_id: string
          boss_type: string
          encounter_index: number
          first_seen_at: string
          guild_code: string
          id: number
          loop_index: number
          rarity: string
          season: number
          set_num: number
          tier: number | null
        }
        Insert: {
          boss_id: string
          boss_type: string
          encounter_index: number
          first_seen_at?: string
          guild_code: string
          id?: number
          loop_index?: number
          rarity: string
          season: number
          set_num: number
          tier?: number | null
        }
        Update: {
          boss_id?: string
          boss_type?: string
          encounter_index?: number
          first_seen_at?: string
          guild_code?: string
          id?: number
          loop_index?: number
          rarity?: string
          season?: number
          set_num?: number
          tier?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "herald_boss_availability_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "herald_boss_availability_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "herald_boss_availability_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      herald_boss_config: {
        Row: {
          boss_id: string
          created_at: string
          custom_message_url: string | null
          discord_role_ids: string[]
          discord_role_labels: Json
          enabled: boolean
          extra_links: Json
          extra_videos: Json
          guild_code: string
          id: number
          notes: string | null
          ping_mode: string
          ping_mode_explicit: boolean
          rarity_set: string | null
          side1_behaviour: string
          side1_notes: string | null
          side1_threshold_hp_pct: number | null
          side2_behaviour: string
          side2_notes: string | null
          side2_threshold_hp_pct: number | null
          updated_at: string
          updated_by: string | null
          webhook_config_ids: string[]
        }
        Insert: {
          boss_id: string
          created_at?: string
          custom_message_url?: string | null
          discord_role_ids?: string[]
          discord_role_labels?: Json
          enabled?: boolean
          extra_links?: Json
          extra_videos?: Json
          guild_code: string
          id?: number
          notes?: string | null
          ping_mode?: string
          ping_mode_explicit?: boolean
          rarity_set?: string | null
          side1_behaviour?: string
          side1_notes?: string | null
          side1_threshold_hp_pct?: number | null
          side2_behaviour?: string
          side2_notes?: string | null
          side2_threshold_hp_pct?: number | null
          updated_at?: string
          updated_by?: string | null
          webhook_config_ids?: string[]
        }
        Update: {
          boss_id?: string
          created_at?: string
          custom_message_url?: string | null
          discord_role_ids?: string[]
          discord_role_labels?: Json
          enabled?: boolean
          extra_links?: Json
          extra_videos?: Json
          guild_code?: string
          id?: number
          notes?: string | null
          ping_mode?: string
          ping_mode_explicit?: boolean
          rarity_set?: string | null
          side1_behaviour?: string
          side1_notes?: string | null
          side1_threshold_hp_pct?: number | null
          side2_behaviour?: string
          side2_notes?: string | null
          side2_threshold_hp_pct?: number | null
          updated_at?: string
          updated_by?: string | null
          webhook_config_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "herald_boss_config_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "herald_boss_config_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "herald_boss_config_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      herald_config_versions: {
        Row: {
          config_snapshot: Json
          created_at: string
          created_by: string | null
          guild_code: string
          id: number
          is_default: boolean
          season: number | null
        }
        Insert: {
          config_snapshot: Json
          created_at?: string
          created_by?: string | null
          guild_code: string
          id?: number
          is_default?: boolean
          season?: number | null
        }
        Update: {
          config_snapshot?: Json
          created_at?: string
          created_by?: string | null
          guild_code?: string
          id?: number
          is_default?: boolean
          season?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "herald_config_versions_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "herald_config_versions_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "herald_config_versions_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      herald_meta_role_mapping: {
        Row: {
          active_boss_ids: string[] | null
          auto_update: boolean
          created_at: string
          custom_message_only: boolean
          discord_role_id: string | null
          display_label: string | null
          enabled: boolean
          guild_code: string
          id: number
          last_auto_updated_at: string | null
          meta_team_slug: string
          prime_scope: string
          rarity_set: string | null
          track_only: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          active_boss_ids?: string[] | null
          auto_update?: boolean
          created_at?: string
          custom_message_only?: boolean
          discord_role_id?: string | null
          display_label?: string | null
          enabled?: boolean
          guild_code: string
          id?: number
          last_auto_updated_at?: string | null
          meta_team_slug: string
          prime_scope?: string
          rarity_set?: string | null
          track_only?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          active_boss_ids?: string[] | null
          auto_update?: boolean
          created_at?: string
          custom_message_only?: boolean
          discord_role_id?: string | null
          display_label?: string | null
          enabled?: boolean
          guild_code?: string
          id?: number
          last_auto_updated_at?: string | null
          meta_team_slug?: string
          prime_scope?: string
          rarity_set?: string | null
          track_only?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "herald_meta_role_mapping_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "herald_meta_role_mapping_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "herald_meta_role_mapping_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      herald_posted_events: {
        Row: {
          boss_id: string
          completed_on: number | null
          encounter_index: number | null
          guild_code: string
          id: number
          loop_index: number | null
          posted_at: string
          season: number | null
          transition_type: string
          webhook_response_status: number | null
        }
        Insert: {
          boss_id: string
          completed_on?: number | null
          encounter_index?: number | null
          guild_code: string
          id?: number
          loop_index?: number | null
          posted_at?: string
          season?: number | null
          transition_type: string
          webhook_response_status?: number | null
        }
        Update: {
          boss_id?: string
          completed_on?: number | null
          encounter_index?: number | null
          guild_code?: string
          id?: number
          loop_index?: number | null
          posted_at?: string
          season?: number | null
          transition_type?: string
          webhook_response_status?: number | null
        }
        Relationships: []
      }
      hero_mappings: {
        Row: {
          active_ability: string | null
          alliance_id: string | null
          avatar_id: string | null
          base_armor: number | null
          base_damage: number | null
          base_health: number | null
          base_rarity: string | null
          category: string | null
          created_at: string | null
          damage_profiles: string[] | null
          description: string | null
          discord_emoji: string | null
          discord_emoji_id: string | null
          display_name: string | null
          faction_id: string | null
          game_id: string | null
          icon_url: string | null
          id: number
          item_slots: string[] | null
          long_name: string | null
          movement: number | null
          mow_active_abilities: string[] | null
          mythic_abilities: string[] | null
          passive_ability: string | null
          sorting: number | null
          traits: string[] | null
          unit_id: string
          updated_at: string | null
          web_icon_url: string | null
        }
        Insert: {
          active_ability?: string | null
          alliance_id?: string | null
          avatar_id?: string | null
          base_armor?: number | null
          base_damage?: number | null
          base_health?: number | null
          base_rarity?: string | null
          category?: string | null
          created_at?: string | null
          damage_profiles?: string[] | null
          description?: string | null
          discord_emoji?: string | null
          discord_emoji_id?: string | null
          display_name?: string | null
          faction_id?: string | null
          game_id?: string | null
          icon_url?: string | null
          id?: number
          item_slots?: string[] | null
          long_name?: string | null
          movement?: number | null
          mow_active_abilities?: string[] | null
          mythic_abilities?: string[] | null
          passive_ability?: string | null
          sorting?: number | null
          traits?: string[] | null
          unit_id: string
          updated_at?: string | null
          web_icon_url?: string | null
        }
        Update: {
          active_ability?: string | null
          alliance_id?: string | null
          avatar_id?: string | null
          base_armor?: number | null
          base_damage?: number | null
          base_health?: number | null
          base_rarity?: string | null
          category?: string | null
          created_at?: string | null
          damage_profiles?: string[] | null
          description?: string | null
          discord_emoji?: string | null
          discord_emoji_id?: string | null
          display_name?: string | null
          faction_id?: string | null
          game_id?: string | null
          icon_url?: string | null
          id?: number
          item_slots?: string[] | null
          long_name?: string | null
          movement?: number | null
          mow_active_abilities?: string[] | null
          mythic_abilities?: string[] | null
          passive_ability?: string | null
          sorting?: number | null
          traits?: string[] | null
          unit_id?: string
          updated_at?: string | null
          web_icon_url?: string | null
        }
        Relationships: []
      }
      log_export_requests: {
        Row: {
          created_at: string | null
          email_sent_at: string | null
          error_message: string | null
          export_options: Json
          guild_code: string
          id: string
          requested_at: string | null
          requested_by: string | null
          scheduled_for: string
          status: string | null
        }
        Insert: {
          created_at?: string | null
          email_sent_at?: string | null
          error_message?: string | null
          export_options: Json
          guild_code: string
          id?: string
          requested_at?: string | null
          requested_by?: string | null
          scheduled_for: string
          status?: string | null
        }
        Update: {
          created_at?: string | null
          email_sent_at?: string | null
          error_message?: string | null
          export_options?: Json
          guild_code?: string
          id?: string
          requested_at?: string | null
          requested_by?: string | null
          scheduled_for?: string
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "log_export_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      login_audit: {
        Row: {
          created_at: string
          login_date: string
          user_id: string
        }
        Insert: {
          created_at?: string
          login_date?: string
          user_id: string
        }
        Update: {
          created_at?: string
          login_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "login_audit_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      loki_globalconfig_alert_state: {
        Row: {
          alerted_at: string
          content_fingerprint: string
          delivered_at: string | null
          id: boolean
          new_version: string | null
          old_version: string | null
        }
        Insert: {
          alerted_at?: string
          content_fingerprint: string
          delivered_at?: string | null
          id?: boolean
          new_version?: string | null
          old_version?: string | null
        }
        Update: {
          alerted_at?: string
          content_fingerprint?: string
          delivered_at?: string | null
          id?: boolean
          new_version?: string | null
          old_version?: string | null
        }
        Relationships: []
      }
      maps: {
        Row: {
          boss_mapping_id: number | null
          created_at: string | null
          height: number
          id: string
          image_url: string | null
          terrain_crit_bonus: number | null
          terrain_damage_bonus: number | null
          width: number
        }
        Insert: {
          boss_mapping_id?: number | null
          created_at?: string | null
          height: number
          id: string
          image_url?: string | null
          terrain_crit_bonus?: number | null
          terrain_damage_bonus?: number | null
          width: number
        }
        Update: {
          boss_mapping_id?: number | null
          created_at?: string | null
          height?: number
          id?: string
          image_url?: string | null
          terrain_crit_bonus?: number | null
          terrain_damage_bonus?: number | null
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "maps_boss_mapping_id_fkey"
            columns: ["boss_mapping_id"]
            isOneToOne: false
            referencedRelation: "boss_identifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maps_boss_mapping_id_fkey"
            columns: ["boss_mapping_id"]
            isOneToOne: false
            referencedRelation: "boss_mapping"
            referencedColumns: ["id"]
          },
        ]
      }
      meta_atlas_dag_edges: {
        Row: {
          boss_type: string
          boss_unit_id: string | null
          created_at: string
          damage_gain: number | null
          encounter_index: number
          from_damage_p90: number | null
          from_team_hash: string
          rarity_set: string
          season: string
          swapped_in: string
          swapped_out: string
          to_damage_p90: number | null
          to_team_hash: string
          updated_at: string
        }
        Insert: {
          boss_type: string
          boss_unit_id?: string | null
          created_at?: string
          damage_gain?: number | null
          encounter_index?: number
          from_damage_p90?: number | null
          from_team_hash: string
          rarity_set: string
          season: string
          swapped_in: string
          swapped_out: string
          to_damage_p90?: number | null
          to_team_hash: string
          updated_at?: string
        }
        Update: {
          boss_type?: string
          boss_unit_id?: string | null
          created_at?: string
          damage_gain?: number | null
          encounter_index?: number
          from_damage_p90?: number | null
          from_team_hash?: string
          rarity_set?: string
          season?: string
          swapped_in?: string
          swapped_out?: string
          to_damage_p90?: number | null
          to_team_hash?: string
          updated_at?: string
        }
        Relationships: []
      }
      meta_atlas_data: {
        Row: {
          attack_count: number | null
          boss_type: string
          boss_unit_id: string | null
          damage_avg: number | null
          damage_max: number | null
          damage_p75: number | null
          damage_p90: number | null
          encounter_index: number
          encounter_type: string | null
          map_id: string | null
          meta_team: string | null
          rarity: string
          rarity_set: string | null
          season: string
          set_num: number
          sub_boss_name: string
          team_composition: string | null
          team_hash: string
          updated_at: string | null
        }
        Insert: {
          attack_count?: number | null
          boss_type: string
          boss_unit_id?: string | null
          damage_avg?: number | null
          damage_max?: number | null
          damage_p75?: number | null
          damage_p90?: number | null
          encounter_index?: number
          encounter_type?: string | null
          map_id?: string | null
          meta_team?: string | null
          rarity: string
          rarity_set?: string | null
          season: string
          set_num: number
          sub_boss_name: string
          team_composition?: string | null
          team_hash: string
          updated_at?: string | null
        }
        Update: {
          attack_count?: number | null
          boss_type?: string
          boss_unit_id?: string | null
          damage_avg?: number | null
          damage_max?: number | null
          damage_p75?: number | null
          damage_p90?: number | null
          encounter_index?: number
          encounter_type?: string | null
          map_id?: string | null
          meta_team?: string | null
          rarity?: string
          rarity_set?: string | null
          season?: string
          set_num?: number
          sub_boss_name?: string
          team_composition?: string | null
          team_hash?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      meta_teams: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_meta: boolean | null
          match_type: string | null
          sort_order: number | null
          team_name: string
          trigger_heroes: Json | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_meta?: boolean | null
          match_type?: string | null
          sort_order?: number | null
          team_name: string
          trigger_heroes?: Json | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_meta?: boolean | null
          match_type?: string | null
          sort_order?: number | null
          team_name?: string
          trigger_heroes?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      onboarding_jobs: {
        Row: {
          attempts: number
          cluster_code: string | null
          completed_at: string | null
          created_at: string
          error_message: string | null
          guild_code: string | null
          id: string
          job_type: string
          last_error_at: string | null
          max_attempts: number
          payload: Json | null
          result: Json | null
          started_at: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          attempts?: number
          cluster_code?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          guild_code?: string | null
          id?: string
          job_type: string
          last_error_at?: string | null
          max_attempts?: number
          payload?: Json | null
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          attempts?: number
          cluster_code?: string | null
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          guild_code?: string | null
          id?: string
          job_type?: string
          last_error_at?: string | null
          max_attempts?: number
          payload?: Json | null
          result?: Json | null
          started_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_jobs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      onboarding_progress: {
        Row: {
          created_at: string | null
          guild_can_retry: boolean | null
          guild_attempt_generation: number
          guild_code: string | null
          guild_error_message: string | null
          guild_lock_expires_at: string | null
          guild_mode: string | null
          guild_name: string | null
          guild_status: string | null
          player_id: string | null
          player_name: string | null
          profile_can_retry: boolean | null
          profile_error_message: string | null
          profile_status: string | null
          role_intent: string | null
          sync_can_retry: boolean | null
          sync_error_message: string | null
          sync_progress: number | null
          sync_records_synced: number | null
          sync_status: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          guild_can_retry?: boolean | null
          guild_attempt_generation?: number
          guild_code?: string | null
          guild_error_message?: string | null
          guild_lock_expires_at?: string | null
          guild_mode?: string | null
          guild_name?: string | null
          guild_status?: string | null
          player_id?: string | null
          player_name?: string | null
          profile_can_retry?: boolean | null
          profile_error_message?: string | null
          profile_status?: string | null
          role_intent?: string | null
          sync_can_retry?: boolean | null
          sync_error_message?: string | null
          sync_progress?: number | null
          sync_records_synced?: number | null
          sync_status?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          guild_can_retry?: boolean | null
          guild_attempt_generation?: number
          guild_code?: string | null
          guild_error_message?: string | null
          guild_lock_expires_at?: string | null
          guild_mode?: string | null
          guild_name?: string | null
          guild_status?: string | null
          player_id?: string | null
          player_name?: string | null
          profile_can_retry?: boolean | null
          profile_error_message?: string | null
          profile_status?: string | null
          role_intent?: string | null
          sync_can_retry?: boolean | null
          sync_error_message?: string | null
          sync_progress?: number | null
          sync_records_synced?: number | null
          sync_status?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      pgnet_watchdog_state: {
        Row: {
          id: boolean
          last_alert_at: string | null
        }
        Insert: {
          id?: boolean
          last_alert_at?: string | null
        }
        Update: {
          id?: boolean
          last_alert_at?: string | null
        }
        Relationships: []
      }
      player_achievements: {
        Row: {
          achievement_key: string
          id: number
          unlocked_at: string
          user_id: string
          value: Json | null
        }
        Insert: {
          achievement_key: string
          id?: number
          unlocked_at?: string
          user_id: string
          value?: Json | null
        }
        Update: {
          achievement_key?: string
          id?: number
          unlocked_at?: string
          user_id?: string
          value?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "player_achievements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      player_avatar_frames: {
        Row: {
          avatar_id: string
          created_at: string | null
          display_name: string | null
          hero_unit_id: string | null
          icon_url: string | null
          id: string
          is_premium: boolean | null
          updated_at: string | null
        }
        Insert: {
          avatar_id: string
          created_at?: string | null
          display_name?: string | null
          hero_unit_id?: string | null
          icon_url?: string | null
          id?: string
          is_premium?: boolean | null
          updated_at?: string | null
        }
        Update: {
          avatar_id?: string
          created_at?: string | null
          display_name?: string | null
          hero_unit_id?: string | null
          icon_url?: string | null
          id?: string
          is_premium?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      player_claim_audit: {
        Row: {
          claimed_at: string
          details: Json | null
          guild_code: string | null
          id: number
          outcome: string
          player_id: string | null
          request_ip: unknown
          source_path: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          claimed_at?: string
          details?: Json | null
          guild_code?: string | null
          id?: number
          outcome: string
          player_id?: string | null
          request_ip?: unknown
          source_path?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          claimed_at?: string
          details?: Json | null
          guild_code?: string | null
          id?: number
          outcome?: string
          player_id?: string | null
          request_ip?: unknown
          source_path?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      player_identity_attestation_revocations: {
        Row: {
          actor_role: string
          actor_user_id: string | null
          attestation_id: string
          id: string
          reason: string
          revoked_at: string
          source: string
        }
        Insert: {
          actor_role: string
          actor_user_id?: string | null
          attestation_id: string
          id?: string
          reason: string
          revoked_at?: string
          source: string
        }
        Update: {
          actor_role?: string
          actor_user_id?: string | null
          attestation_id?: string
          id?: string
          reason?: string
          revoked_at?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_identity_attestation_revocations_attestation_id_fkey"
            columns: ["attestation_id"]
            isOneToOne: true
            referencedRelation: "player_identity_attestations"
            referencedColumns: ["id"]
          },
        ]
      }
      player_identity_attestations: {
        Row: {
          attested_at: string
          consumed_at: string
          guild_code_snapshot: string | null
          id: string
          mapping_id: number
          player_id: string
          source: string
          source_invite_id: string | null
          subject_user_id: string
        }
        Insert: {
          attested_at?: string
          consumed_at: string
          guild_code_snapshot?: string | null
          id?: string
          mapping_id: number
          player_id: string
          source: string
          source_invite_id?: string | null
          subject_user_id: string
        }
        Update: {
          attested_at?: string
          consumed_at?: string
          guild_code_snapshot?: string | null
          id?: string
          mapping_id?: number
          player_id?: string
          source?: string
          source_invite_id?: string | null
          subject_user_id?: string
        }
        Relationships: []
      }
      player_identity_discord_generation_activations: {
        Row: {
          activated_at: string
          auth_identity_id: string
          id: string
          identity_updated_at: string
          ownership_attestation_id: string
          pending_id: string
          provider_id_sha256: string
          subject_user_id: string
        }
        Insert: {
          activated_at?: string
          auth_identity_id: string
          id?: string
          identity_updated_at: string
          ownership_attestation_id: string
          pending_id: string
          provider_id_sha256: string
          subject_user_id: string
        }
        Update: {
          activated_at?: string
          auth_identity_id?: string
          id?: string
          identity_updated_at?: string
          ownership_attestation_id?: string
          pending_id?: string
          provider_id_sha256?: string
          subject_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_identity_discord_generatio_ownership_attestation_id_fkey"
            columns: ["ownership_attestation_id"]
            isOneToOne: false
            referencedRelation: "player_identity_attestations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_identity_discord_generation_activations_pending_id_fkey"
            columns: ["pending_id"]
            isOneToOne: true
            referencedRelation: "player_identity_discord_unlink_pending"
            referencedColumns: ["id"]
          },
        ]
      }
      player_identity_discord_invalidation_events: {
        Row: {
          affected_mapping_count: number
          id: number
          invalidated_at: string
          operation: string
        }
        Insert: {
          affected_mapping_count: number
          id?: number
          invalidated_at?: string
          operation: string
        }
        Update: {
          affected_mapping_count?: number
          id?: number
          invalidated_at?: string
          operation?: string
        }
        Relationships: []
      }
      player_identity_discord_unlink_pending: {
        Row: {
          generation: number
          id: string
          ownership_attestation_id: string | null
          prepared_at: string
          prior_auth_identity_id: string | null
          prior_identity_updated_at: string | null
          prior_provider_id_sha256: string | null
          relink_nonce_sha256: string
          subject_user_id: string
        }
        Insert: {
          generation: number
          id?: string
          ownership_attestation_id?: string | null
          prepared_at?: string
          prior_auth_identity_id?: string | null
          prior_identity_updated_at?: string | null
          prior_provider_id_sha256?: string | null
          relink_nonce_sha256: string
          subject_user_id: string
        }
        Update: {
          generation?: number
          id?: string
          ownership_attestation_id?: string | null
          prepared_at?: string
          prior_auth_identity_id?: string | null
          prior_identity_updated_at?: string | null
          prior_provider_id_sha256?: string | null
          relink_nonce_sha256?: string
          subject_user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_identity_discord_unlink_pe_ownership_attestation_id_fkey"
            columns: ["ownership_attestation_id"]
            isOneToOne: false
            referencedRelation: "player_identity_attestations"
            referencedColumns: ["id"]
          },
        ]
      }
      player_identity_quarantine_events: {
        Row: {
          actor_role: string
          details: Json
          event_type: string
          id: number
          quarantine_id: string
          recorded_at: string
        }
        Insert: {
          actor_role: string
          details?: Json
          event_type: string
          id?: number
          quarantine_id: string
          recorded_at?: string
        }
        Update: {
          actor_role?: string
          details?: Json
          event_type?: string
          id?: number
          quarantine_id?: string
          recorded_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_identity_quarantine_events_quarantine_id_fkey"
            columns: ["quarantine_id"]
            isOneToOne: false
            referencedRelation: "player_identity_quarantine_evidence"
            referencedColumns: ["id"]
          },
        ]
      }
      player_identity_quarantine_evidence: {
        Row: {
          classification: string
          classified_at: string
          discord_identity_match_count: number
          had_discord_binding: boolean
          had_user_binding: boolean
          id: string
          invite_match_count: number
          prior_app_admin: boolean
          prior_role: string | null
        }
        Insert: {
          classification: string
          classified_at?: string
          discord_identity_match_count: number
          had_discord_binding: boolean
          had_user_binding: boolean
          id: string
          invite_match_count: number
          prior_app_admin?: boolean
          prior_role?: string | null
        }
        Update: {
          classification?: string
          classified_at?: string
          discord_identity_match_count?: number
          had_discord_binding?: boolean
          had_user_binding?: boolean
          id?: string
          invite_match_count?: number
          prior_app_admin?: boolean
          prior_role?: string | null
        }
        Relationships: []
      }
      player_identity_quarantine_pii: {
        Row: {
          guild_code: string | null
          mapping_id: number
          player_id: string
          prior_discord_user_id: string | null
          prior_discord_username: string | null
          prior_user_id: string | null
          quarantine_id: string
          retained_at: string
        }
        Insert: {
          guild_code?: string | null
          mapping_id: number
          player_id: string
          prior_discord_user_id?: string | null
          prior_discord_username?: string | null
          prior_user_id?: string | null
          quarantine_id: string
          retained_at?: string
        }
        Update: {
          guild_code?: string | null
          mapping_id?: number
          player_id?: string
          prior_discord_user_id?: string | null
          prior_discord_username?: string | null
          prior_user_id?: string | null
          quarantine_id?: string
          retained_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_identity_quarantine_pii_quarantine_id_fkey"
            columns: ["quarantine_id"]
            isOneToOne: true
            referencedRelation: "player_identity_quarantine_evidence"
            referencedColumns: ["id"]
          },
        ]
      }
      player_identity_subject_authority_blocks: {
        Row: {
          blocked_at: string
          reason: string
          source: string
          subject_user_id: string
        }
        Insert: {
          blocked_at?: string
          reason: string
          source: string
          subject_user_id: string
        }
        Update: {
          blocked_at?: string
          reason?: string
          source?: string
          subject_user_id?: string
        }
        Relationships: []
      }
      player_invite_codes: {
        Row: {
          code: string
          created_at: string | null
          created_by: string | null
          display_name: string
          expires_at: string
          guild_code: string
          id: string
          player_id: string
          revoked_at: string | null
          revoked_by: string | null
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          code: string
          created_at?: string | null
          created_by?: string | null
          display_name: string
          expires_at: string
          guild_code: string
          id?: string
          player_id: string
          revoked_at?: string | null
          revoked_by?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          code?: string
          created_at?: string | null
          created_by?: string | null
          display_name?: string
          expires_at?: string
          guild_code?: string
          id?: string
          player_id?: string
          revoked_at?: string | null
          revoked_by?: string | null
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_invite_codes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "player_invite_codes_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "player_invite_codes_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "player_invite_codes_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "player_invite_codes_revoked_by_fkey"
            columns: ["revoked_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "player_invite_codes_used_by_fkey"
            columns: ["used_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      player_mapping: {
        Row: {
          api_key_added_at: string | null
          api_key_is_valid: boolean | null
          api_key_last_verified: string | null
          assigned_at: string | null
          assigned_by: string | null
          assignment_notes: string | null
          auto_generated: boolean | null
          avatar_unit_id: string | null
          avatar_url: string | null
          boss_preferences: Json | null
          cluster_code: string | null
          cluster_id: string | null
          created_at: string | null
          discord_user_id: string | null
          discord_username: string | null
          display_name: string
          guild_code: string | null
          has_duplicate_name: boolean | null
          id: number
          is_active: boolean | null
          is_app_admin: boolean | null
          is_current: boolean | null
          last_active_at: string | null
          last_battle_time: string | null
          last_sync_at: string | null
          last_sync_bombs: number | null
          last_sync_tokens: number | null
          next_bomb_seconds: number | null
          next_token_seconds: number | null
          notify_boss_kills: boolean | null
          notify_prime_kills: boolean | null
          notify_when_capped: boolean | null
          officer_notes: string | null
          original_display_name: string | null
          ownership_attestation_id: string | null
          patreon_user_id: string | null
          player_id: string
          player_level: number | null
          player_notes: string | null
          player_power: number | null
          preferences_updated_at: string | null
          primary_boss: string | null
          primary_team: string | null
          protected: boolean | null
          role: Database["public"]["Enums"]["app_role"] | null
          secondary_boss: string | null
          secondary_team: string | null
          tacticus_api_key_encrypted: string | null
          tacticus_share_url: string | null
          tertiary_team: string | null
          theme_preference: string | null
          timezone: string | null
          updated_at: string | null
          user_id: string | null
          username: string | null
        }
        Insert: {
          api_key_added_at?: string | null
          api_key_is_valid?: boolean | null
          api_key_last_verified?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assignment_notes?: string | null
          auto_generated?: boolean | null
          avatar_unit_id?: string | null
          avatar_url?: string | null
          boss_preferences?: Json | null
          cluster_code?: string | null
          cluster_id?: string | null
          created_at?: string | null
          discord_user_id?: string | null
          discord_username?: string | null
          display_name: string
          guild_code?: string | null
          has_duplicate_name?: boolean | null
          id?: number
          is_active?: boolean | null
          is_app_admin?: boolean | null
          is_current?: boolean | null
          last_active_at?: string | null
          last_battle_time?: string | null
          last_sync_at?: string | null
          last_sync_bombs?: number | null
          last_sync_tokens?: number | null
          next_bomb_seconds?: number | null
          next_token_seconds?: number | null
          notify_boss_kills?: boolean | null
          notify_prime_kills?: boolean | null
          notify_when_capped?: boolean | null
          officer_notes?: string | null
          original_display_name?: string | null
          ownership_attestation_id?: string | null
          patreon_user_id?: string | null
          player_id: string
          player_level?: number | null
          player_notes?: string | null
          player_power?: number | null
          preferences_updated_at?: string | null
          primary_boss?: string | null
          primary_team?: string | null
          protected?: boolean | null
          role?: Database["public"]["Enums"]["app_role"] | null
          secondary_boss?: string | null
          secondary_team?: string | null
          tacticus_api_key_encrypted?: string | null
          tacticus_share_url?: string | null
          tertiary_team?: string | null
          theme_preference?: string | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string | null
          username?: string | null
        }
        Update: {
          api_key_added_at?: string | null
          api_key_is_valid?: boolean | null
          api_key_last_verified?: string | null
          assigned_at?: string | null
          assigned_by?: string | null
          assignment_notes?: string | null
          auto_generated?: boolean | null
          avatar_unit_id?: string | null
          avatar_url?: string | null
          boss_preferences?: Json | null
          cluster_code?: string | null
          cluster_id?: string | null
          created_at?: string | null
          discord_user_id?: string | null
          discord_username?: string | null
          display_name?: string
          guild_code?: string | null
          has_duplicate_name?: boolean | null
          id?: number
          is_active?: boolean | null
          is_app_admin?: boolean | null
          is_current?: boolean | null
          last_active_at?: string | null
          last_battle_time?: string | null
          last_sync_at?: string | null
          last_sync_bombs?: number | null
          last_sync_tokens?: number | null
          next_bomb_seconds?: number | null
          next_token_seconds?: number | null
          notify_boss_kills?: boolean | null
          notify_prime_kills?: boolean | null
          notify_when_capped?: boolean | null
          officer_notes?: string | null
          original_display_name?: string | null
          ownership_attestation_id?: string | null
          patreon_user_id?: string | null
          player_id?: string
          player_level?: number | null
          player_notes?: string | null
          player_power?: number | null
          preferences_updated_at?: string | null
          primary_boss?: string | null
          primary_team?: string | null
          protected?: boolean | null
          role?: Database["public"]["Enums"]["app_role"] | null
          secondary_boss?: string | null
          secondary_team?: string | null
          tacticus_api_key_encrypted?: string | null
          tacticus_share_url?: string | null
          tertiary_team?: string | null
          theme_preference?: string | null
          timezone?: string | null
          updated_at?: string | null
          user_id?: string | null
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_mapping_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "player_mapping_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "player_mapping_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "player_mapping_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "player_mapping_ownership_attestation_fkey"
            columns: ["ownership_attestation_id"]
            isOneToOne: false
            referencedRelation: "player_identity_attestations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_mapping_primary_team_fkey"
            columns: ["primary_team"]
            isOneToOne: false
            referencedRelation: "meta_teams"
            referencedColumns: ["team_name"]
          },
          {
            foreignKeyName: "player_mapping_secondary_team_fkey"
            columns: ["secondary_team"]
            isOneToOne: false
            referencedRelation: "meta_teams"
            referencedColumns: ["team_name"]
          },
          {
            foreignKeyName: "player_mapping_tertiary_team_fkey"
            columns: ["tertiary_team"]
            isOneToOne: false
            referencedRelation: "meta_teams"
            referencedColumns: ["team_name"]
          },
          {
            foreignKeyName: "player_mapping_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      player_meta_roles: {
        Row: {
          created_at: string
          id: string
          meta_team_id: string
          set_by: string | null
          source: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          meta_team_id: string
          set_by?: string | null
          source: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          meta_team_id?: string
          set_by?: string | null
          source?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "player_meta_roles_meta_team_id_fkey"
            columns: ["meta_team_id"]
            isOneToOne: false
            referencedRelation: "meta_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_meta_roles_set_by_fkey"
            columns: ["set_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "player_meta_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      player_roster: {
        Row: {
          active_ability_level: number | null
          booster_item_id: string | null
          booster_item_level: number | null
          crit_item_id: string | null
          crit_item_level: number | null
          defensive_item_id: string | null
          defensive_item_level: number | null
          hero_mapping_id: number | null
          id: number
          mythic_shards: number | null
          passive_ability_level: number | null
          player_mapping_id: number | null
          progression_index: number | null
          rank_name: string
          rarity: string | null
          shards: number | null
          stars: number | null
          synced_at: string | null
          upgrades: number[] | null
          user_id: string | null
          xp: number | null
          xp_level: number | null
        }
        Insert: {
          active_ability_level?: number | null
          booster_item_id?: string | null
          booster_item_level?: number | null
          crit_item_id?: string | null
          crit_item_level?: number | null
          defensive_item_id?: string | null
          defensive_item_level?: number | null
          hero_mapping_id?: number | null
          id?: number
          mythic_shards?: number | null
          passive_ability_level?: number | null
          player_mapping_id?: number | null
          progression_index?: number | null
          rank_name: string
          rarity?: string | null
          shards?: number | null
          stars?: number | null
          synced_at?: string | null
          upgrades?: number[] | null
          user_id?: string | null
          xp?: number | null
          xp_level?: number | null
        }
        Update: {
          active_ability_level?: number | null
          booster_item_id?: string | null
          booster_item_level?: number | null
          crit_item_id?: string | null
          crit_item_level?: number | null
          defensive_item_id?: string | null
          defensive_item_level?: number | null
          hero_mapping_id?: number | null
          id?: number
          mythic_shards?: number | null
          passive_ability_level?: number | null
          player_mapping_id?: number | null
          progression_index?: number | null
          rank_name?: string
          rarity?: string | null
          shards?: number | null
          stars?: number | null
          synced_at?: string | null
          upgrades?: number[] | null
          user_id?: string | null
          xp?: number | null
          xp_level?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "player_roster_hero_mapping_id_fkey"
            columns: ["hero_mapping_id"]
            isOneToOne: false
            referencedRelation: "hero_mappings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_roster_player_mapping_id_fkey"
            columns: ["player_mapping_id"]
            isOneToOne: false
            referencedRelation: "player_mapping"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_roster_player_mapping_id_fkey"
            columns: ["player_mapping_id"]
            isOneToOne: false
            referencedRelation: "user_profiles_with_guild"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "player_roster_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      public_guild_snapshots: {
        Row: {
          active_players: number | null
          average_damage: number | null
          avg_damage_per_battle: number | null
          cluster_code: string | null
          cluster_name: string | null
          explore_obfuscation_percent: number
          explore_privacy_mode: Json | null
          guild_code: string
          guild_name: string | null
          guild_tag: string | null
          last_updated: string | null
          member_count: number | null
          rank: number | null
          season: number
          top_boss_hits: Json | null
          total_battles: number | null
          total_damage: number | null
          veteran_count: number | null
          votlw_champions: Json | null
          votlw_count: number | null
          war_rank: number | null
        }
        Insert: {
          active_players?: number | null
          average_damage?: number | null
          avg_damage_per_battle?: number | null
          cluster_code?: string | null
          cluster_name?: string | null
          explore_obfuscation_percent?: number
          explore_privacy_mode?: Json | null
          guild_code: string
          guild_name?: string | null
          guild_tag?: string | null
          last_updated?: string | null
          member_count?: number | null
          rank?: number | null
          season: number
          top_boss_hits?: Json | null
          total_battles?: number | null
          total_damage?: number | null
          veteran_count?: number | null
          votlw_champions?: Json | null
          votlw_count?: number | null
          war_rank?: number | null
        }
        Update: {
          active_players?: number | null
          average_damage?: number | null
          avg_damage_per_battle?: number | null
          cluster_code?: string | null
          cluster_name?: string | null
          explore_obfuscation_percent?: number
          explore_privacy_mode?: Json | null
          guild_code?: string
          guild_name?: string | null
          guild_tag?: string | null
          last_updated?: string | null
          member_count?: number | null
          rank?: number | null
          season?: number
          top_boss_hits?: Json | null
          total_battles?: number | null
          total_damage?: number | null
          veteran_count?: number | null
          votlw_champions?: Json | null
          votlw_count?: number | null
          war_rank?: number | null
        }
        Relationships: []
      }
      raid_progression_config: {
        Row: {
          created_at: string | null
          first_pass_sequence: string[]
          game_version: string | null
          id: string
          is_active: boolean
          loop_sequence: string[]
          loop_start_stage: string
          scope: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          first_pass_sequence: string[]
          game_version?: string | null
          id?: string
          is_active?: boolean
          loop_sequence: string[]
          loop_start_stage?: string
          scope?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          first_pass_sequence?: string[]
          game_version?: string | null
          id?: string
          is_active?: boolean
          loop_sequence?: string[]
          loop_start_stage?: string
          scope?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      role_reconciliation_events: {
        Row: {
          action: string
          created_at: string
          discord_role_id: string | null
          guild_code: string
          http_status: number | null
          id: string
          meta_team_id: string | null
          player_id: string | null
          reason: string | null
          trigger_source: string
          triggered_by: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          discord_role_id?: string | null
          guild_code: string
          http_status?: number | null
          id?: string
          meta_team_id?: string | null
          player_id?: string | null
          reason?: string | null
          trigger_source: string
          triggered_by?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          discord_role_id?: string | null
          guild_code?: string
          http_status?: number | null
          id?: string
          meta_team_id?: string | null
          player_id?: string | null
          reason?: string | null
          trigger_source?: string
          triggered_by?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "role_reconciliation_events_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "role_reconciliation_events_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "role_reconciliation_events_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "role_reconciliation_events_meta_team_id_fkey"
            columns: ["meta_team_id"]
            isOneToOne: false
            referencedRelation: "meta_teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_reconciliation_events_triggered_by_fkey"
            columns: ["triggered_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "role_reconciliation_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      saved_compositions: {
        Row: {
          boss_mapping_id: number | null
          created_at: string | null
          hero_configurations: Json
          hero_placements: Json
          id: string
          last_damage_result: number | null
          map_id: string | null
          name: string
          notes: string | null
          simulation_mode: string | null
          tier_name: string
          turn_plans: Json
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          boss_mapping_id?: number | null
          created_at?: string | null
          hero_configurations: Json
          hero_placements: Json
          id?: string
          last_damage_result?: number | null
          map_id?: string | null
          name: string
          notes?: string | null
          simulation_mode?: string | null
          tier_name: string
          turn_plans?: Json
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          boss_mapping_id?: number | null
          created_at?: string | null
          hero_configurations?: Json
          hero_placements?: Json
          id?: string
          last_damage_result?: number | null
          map_id?: string | null
          name?: string
          notes?: string | null
          simulation_mode?: string | null
          tier_name?: string
          turn_plans?: Json
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "saved_compositions_boss_mapping_id_fkey"
            columns: ["boss_mapping_id"]
            isOneToOne: false
            referencedRelation: "boss_identifiers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_compositions_boss_mapping_id_fkey"
            columns: ["boss_mapping_id"]
            isOneToOne: false
            referencedRelation: "boss_mapping"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_compositions_map_id_fkey"
            columns: ["map_id"]
            isOneToOne: false
            referencedRelation: "maps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "saved_compositions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      schema_migrations: {
        Row: {
          version: string
        }
        Insert: {
          version: string
        }
        Update: {
          version?: string
        }
        Relationships: []
      }
      season_boss_lineup: {
        Row: {
          boss_name: string
          boss_position: number
          boss_type: string | null
          encounter_id: number
          season: number
        }
        Insert: {
          boss_name: string
          boss_position: number
          boss_type?: string | null
          encounter_id?: number
          season: number
        }
        Update: {
          boss_name?: string
          boss_position?: number
          boss_type?: string | null
          encounter_id?: number
          season?: number
        }
        Relationships: []
      }
      season_calendar: {
        Row: {
          created_at: string
          ends_at: string
          notes: string | null
          regen_interval_hours: number
          regen_tokens_per_interval: number
          season_id: number
          season_label: string | null
          starts_at: string
          tokens_per_player_cap: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          ends_at: string
          notes?: string | null
          regen_interval_hours?: number
          regen_tokens_per_interval?: number
          season_id: number
          season_label?: string | null
          starts_at: string
          tokens_per_player_cap?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          ends_at?: string
          notes?: string | null
          regen_interval_hours?: number
          regen_tokens_per_interval?: number
          season_id?: number
          season_label?: string | null
          starts_at?: string
          tokens_per_player_cap?: number
          updated_at?: string
        }
        Relationships: []
      }
      season_summary_tracking: {
        Row: {
          cluster_code: string
          created_at: string | null
          id: string
          season: string
          sent_at: string | null
          summary_data: Json | null
        }
        Insert: {
          cluster_code: string
          created_at?: string | null
          id?: string
          season: string
          sent_at?: string | null
          summary_data?: Json | null
        }
        Update: {
          cluster_code?: string
          created_at?: string | null
          id?: string
          season?: string
          sent_at?: string | null
          summary_data?: Json | null
        }
        Relationships: []
      }
      season_tracking: {
        Row: {
          created_at: string
          id: number
          last_check_date: string
          last_tracked_season: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: number
          last_check_date?: string
          last_tracked_season: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: number
          last_check_date?: string
          last_tracked_season?: number
          updated_at?: string
        }
        Relationships: []
      }
      sync_health: {
        Row: {
          avg_sync_time_ms: number | null
          consecutive_failures: number | null
          data_completeness: number | null
          data_freshness_hours: number | null
          duplicate_battles: number | null
          guild_code: string
          health_status: string | null
          id: number
          last_failed_sync: string | null
          last_roster_write_at: string | null
          last_successful_sync: string | null
          missing_players: number | null
          roster_rows_written_last_pass: number | null
          roster_write_failures: number
          success_rate: number | null
          total_syncs: number | null
          updated_at: string | null
        }
        Insert: {
          avg_sync_time_ms?: number | null
          consecutive_failures?: number | null
          data_completeness?: number | null
          data_freshness_hours?: number | null
          duplicate_battles?: number | null
          guild_code: string
          health_status?: string | null
          id?: number
          last_failed_sync?: string | null
          last_roster_write_at?: string | null
          last_successful_sync?: string | null
          missing_players?: number | null
          roster_rows_written_last_pass?: number | null
          roster_write_failures?: number
          success_rate?: number | null
          total_syncs?: number | null
          updated_at?: string | null
        }
        Update: {
          avg_sync_time_ms?: number | null
          consecutive_failures?: number | null
          data_completeness?: number | null
          data_freshness_hours?: number | null
          duplicate_battles?: number | null
          guild_code?: string
          health_status?: string | null
          id?: number
          last_failed_sync?: string | null
          last_roster_write_at?: string | null
          last_successful_sync?: string | null
          missing_players?: number | null
          roster_rows_written_last_pass?: number | null
          roster_write_failures?: number
          success_rate?: number | null
          total_syncs?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_health_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "sync_health_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "sync_health_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: true
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      sync_metrics: {
        Row: {
          api_calls: number | null
          api_errors: number | null
          api_retry_count: number | null
          created_at: string | null
          error_message: string | null
          guild_code: string
          id: string
          job_id: string | null
          job_type: string
          players_updated: number | null
          processing_time_ms: number | null
          queue_time_ms: number | null
          records_failed: number | null
          records_fetched: number | null
          records_processed: number | null
          success: boolean
          total_time_ms: number | null
        }
        Insert: {
          api_calls?: number | null
          api_errors?: number | null
          api_retry_count?: number | null
          created_at?: string | null
          error_message?: string | null
          guild_code: string
          id?: string
          job_id?: string | null
          job_type: string
          players_updated?: number | null
          processing_time_ms?: number | null
          queue_time_ms?: number | null
          records_failed?: number | null
          records_fetched?: number | null
          records_processed?: number | null
          success: boolean
          total_time_ms?: number | null
        }
        Update: {
          api_calls?: number | null
          api_errors?: number | null
          api_retry_count?: number | null
          created_at?: string | null
          error_message?: string | null
          guild_code?: string
          id?: string
          job_id?: string | null
          job_type?: string
          players_updated?: number | null
          processing_time_ms?: number | null
          queue_time_ms?: number | null
          records_failed?: number | null
          records_fetched?: number | null
          records_processed?: number | null
          success?: boolean
          total_time_ms?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_metrics_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "sync_queue"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_queue: {
        Row: {
          attempts: number | null
          completed_at: string | null
          created_at: string | null
          error_log: Json | null
          guild_code: string
          id: string
          job_type: string
          max_attempts: number | null
          payload: Json | null
          priority: number
          progress: Json | null
          scheduled_for: string | null
          started_at: string | null
          status: string
          updated_at: string | null
          worker_id: string | null
        }
        Insert: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_log?: Json | null
          guild_code: string
          id?: string
          job_type: string
          max_attempts?: number | null
          payload?: Json | null
          priority?: number
          progress?: Json | null
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
          worker_id?: string | null
        }
        Update: {
          attempts?: number | null
          completed_at?: string | null
          created_at?: string | null
          error_log?: Json | null
          guild_code?: string
          id?: string
          job_type?: string
          max_attempts?: number | null
          payload?: Json | null
          priority?: number
          progress?: Json | null
          scheduled_for?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string | null
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_queue_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "sync_queue_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "sync_queue_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      system_config: {
        Row: {
          created_at: string | null
          description: string | null
          key: string
          updated_at: string | null
          value: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          key: string
          updated_at?: string | null
          value: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          key?: string
          updated_at?: string | null
          value?: string
        }
        Relationships: []
      }
      system_logs: {
        Row: {
          created_at: string | null
          id: number
          log_type: string
          message: string
          metadata: Json | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          log_type: string
          message: string
          metadata?: Json | null
        }
        Update: {
          created_at?: string | null
          id?: number
          log_type?: string
          message?: string
          metadata?: Json | null
        }
        Relationships: []
      }
      token_audit_snapshots: {
        Row: {
          battle_rows_seen: number
          constants_ok: boolean
          cpta_tokens: number | null
          cpta_tokens_delta: number | null
          created_at: string
          display_name: string
          guild_code: string
          id: number
          live_bomb_next_seconds: number | null
          live_bomb_regen_delay_seconds: number | null
          live_bombs: number | null
          live_regen_delay_seconds: number
          live_token_next_seconds: number | null
          live_tokens: number
          live_tokens_max: number
          mode: string
          player_id: string
          rpc_data_source: string | null
          rpc_post_snapshot_spends: number | null
          rpc_token_next_seconds: number | null
          rpc_tokens: number | null
          rpc_tokens_delta: number | null
          season: string
        }
        Insert: {
          battle_rows_seen: number
          constants_ok: boolean
          cpta_tokens?: number | null
          cpta_tokens_delta?: number | null
          created_at?: string
          display_name: string
          guild_code: string
          id?: never
          live_bomb_next_seconds?: number | null
          live_bomb_regen_delay_seconds?: number | null
          live_bombs?: number | null
          live_regen_delay_seconds: number
          live_token_next_seconds?: number | null
          live_tokens: number
          live_tokens_max: number
          mode: string
          player_id: string
          rpc_data_source?: string | null
          rpc_post_snapshot_spends?: number | null
          rpc_token_next_seconds?: number | null
          rpc_tokens?: number | null
          rpc_tokens_delta?: number | null
          season: string
        }
        Update: {
          battle_rows_seen?: number
          constants_ok?: boolean
          cpta_tokens?: number | null
          cpta_tokens_delta?: number | null
          created_at?: string
          display_name?: string
          guild_code?: string
          id?: never
          live_bomb_next_seconds?: number | null
          live_bomb_regen_delay_seconds?: number | null
          live_bombs?: number | null
          live_regen_delay_seconds?: number
          live_token_next_seconds?: number | null
          live_tokens?: number
          live_tokens_max?: number
          mode?: string
          player_id?: string
          rpc_data_source?: string | null
          rpc_post_snapshot_spends?: number | null
          rpc_token_next_seconds?: number | null
          rpc_tokens?: number | null
          rpc_tokens_delta?: number | null
          season?: string
        }
        Relationships: []
      }
      token_burn_state: {
        Row: {
          burned_tokens: number
          created_at: string
          display_name: string | null
          guild_code: string
          id: number
          last_over_cap_started_at: string | null
          last_seen_token_next_seconds: number | null
          last_seen_tokens: number | null
          player_id: string | null
          season: string
          time_over_cap_seconds: number
          updated_at: string
        }
        Insert: {
          burned_tokens?: number
          created_at?: string
          display_name?: string | null
          guild_code: string
          id?: number
          last_over_cap_started_at?: string | null
          last_seen_token_next_seconds?: number | null
          last_seen_tokens?: number | null
          player_id?: string | null
          season: string
          time_over_cap_seconds?: number
          updated_at?: string
        }
        Update: {
          burned_tokens?: number
          created_at?: string
          display_name?: string | null
          guild_code?: string
          id?: number
          last_over_cap_started_at?: string | null
          last_seen_token_next_seconds?: number | null
          last_seen_tokens?: number | null
          player_id?: string | null
          season?: string
          time_over_cap_seconds?: number
          updated_at?: string
        }
        Relationships: []
      }
      token_cap_notifications: {
        Row: {
          capped_at: string
          cluster_code: string | null
          created_at: string | null
          display_name: string | null
          guild_code: string
          id: string
          notification_sent: boolean | null
          player_id: string
          sent_at: string | null
          total_capped_in_guild: number | null
        }
        Insert: {
          capped_at: string
          cluster_code?: string | null
          created_at?: string | null
          display_name?: string | null
          guild_code: string
          id?: string
          notification_sent?: boolean | null
          player_id: string
          sent_at?: string | null
          total_capped_in_guild?: number | null
        }
        Update: {
          capped_at?: string
          cluster_code?: string | null
          created_at?: string | null
          display_name?: string | null
          guild_code?: string
          id?: string
          notification_sent?: boolean | null
          player_id?: string
          sent_at?: string | null
          total_capped_in_guild?: number | null
        }
        Relationships: []
      }
      token_notification_events: {
        Row: {
          attempts: number
          created_at: string
          data_source: string | null
          dedupe_key: string
          dedupe_window_seconds: number
          dedupe_window_started_at: string
          delivery_channel: string
          dispatched_at: string | null
          display_name: string | null
          guild_code: string
          id: string
          last_error: string | null
          next_attempt_at: string | null
          notification_type: string
          payload: Json
          player_id: string
          preference_id: string | null
          season: string
          status: string
          token_next_in_seconds: number | null
          tokens_available: number
        }
        Insert: {
          attempts?: number
          created_at?: string
          data_source?: string | null
          dedupe_key: string
          dedupe_window_seconds: number
          dedupe_window_started_at: string
          delivery_channel: string
          dispatched_at?: string | null
          display_name?: string | null
          guild_code: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string | null
          notification_type: string
          payload?: Json
          player_id: string
          preference_id?: string | null
          season: string
          status?: string
          token_next_in_seconds?: number | null
          tokens_available: number
        }
        Update: {
          attempts?: number
          created_at?: string
          data_source?: string | null
          dedupe_key?: string
          dedupe_window_seconds?: number
          dedupe_window_started_at?: string
          delivery_channel?: string
          dispatched_at?: string | null
          display_name?: string | null
          guild_code?: string
          id?: string
          last_error?: string | null
          next_attempt_at?: string | null
          notification_type?: string
          payload?: Json
          player_id?: string
          preference_id?: string | null
          season?: string
          status?: string
          token_next_in_seconds?: number | null
          tokens_available?: number
        }
        Relationships: [
          {
            foreignKeyName: "token_notification_events_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "token_notification_events_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "token_notification_events_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "token_notification_events_preference_id_fkey"
            columns: ["preference_id"]
            isOneToOne: false
            referencedRelation: "token_notification_preferences"
            referencedColumns: ["id"]
          },
        ]
      }
      token_notification_preferences: {
        Row: {
          channel: string
          created_at: string
          created_by: string | null
          dedupe_window_seconds: number
          discord_channel_id: string | null
          enabled: boolean
          guild_code: string
          id: string
          near_cap_threshold_seconds: number
          notify_on_capped: boolean
          notify_on_near_cap: boolean
          notify_on_post_burn: boolean
          notify_on_pre_burn: boolean
          player_id: string | null
          pre_burn_window_seconds: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          channel: string
          created_at?: string
          created_by?: string | null
          dedupe_window_seconds?: number
          discord_channel_id?: string | null
          enabled?: boolean
          guild_code: string
          id?: string
          near_cap_threshold_seconds?: number
          notify_on_capped?: boolean
          notify_on_near_cap?: boolean
          notify_on_post_burn?: boolean
          notify_on_pre_burn?: boolean
          player_id?: string | null
          pre_burn_window_seconds?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          created_by?: string | null
          dedupe_window_seconds?: number
          discord_channel_id?: string | null
          enabled?: boolean
          guild_code?: string
          id?: string
          near_cap_threshold_seconds?: number
          notify_on_capped?: boolean
          notify_on_near_cap?: boolean
          notify_on_post_burn?: boolean
          notify_on_pre_burn?: boolean
          player_id?: string | null
          pre_burn_window_seconds?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "token_notification_preferences_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "token_notification_preferences_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "token_notification_preferences_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      upcoming_season_assignments: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          display_name: string
          guild_code: string
          id: string
          player_id: string
          primary_boss: string | null
          season_number: string
          secondary_boss: string | null
          token_allocations: Json | null
          total_tokens_allocated: number | null
          updated_at: string | null
          uses_flexible_tokens: boolean | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          display_name: string
          guild_code: string
          id?: string
          player_id: string
          primary_boss?: string | null
          season_number: string
          secondary_boss?: string | null
          token_allocations?: Json | null
          total_tokens_allocated?: number | null
          updated_at?: string | null
          uses_flexible_tokens?: boolean | null
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          display_name?: string
          guild_code?: string
          id?: string
          player_id?: string
          primary_boss?: string | null
          season_number?: string
          secondary_boss?: string | null
          token_allocations?: Json | null
          total_tokens_allocated?: number | null
          updated_at?: string | null
          uses_flexible_tokens?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "upcoming_season_assignments_assigned_by_fkey"
            columns: ["assigned_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "upcoming_season_assignments_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "upcoming_season_assignments_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "upcoming_season_assignments_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
        ]
      }
      upcoming_season_bosses: {
        Row: {
          boss_name: string
          guild_code: string
          id: string
          level: string
          season_number: string
          selected_at: string | null
          selected_by: string | null
          sub_bosses: Json | null
        }
        Insert: {
          boss_name: string
          guild_code: string
          id?: string
          level: string
          season_number: string
          selected_at?: string | null
          selected_by?: string | null
          sub_bosses?: Json | null
        }
        Update: {
          boss_name?: string
          guild_code?: string
          id?: string
          level?: string
          season_number?: string
          selected_at?: string | null
          selected_by?: string | null
          sub_bosses?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "upcoming_season_bosses_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "upcoming_season_bosses_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "upcoming_season_bosses_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "upcoming_season_bosses_selected_by_fkey"
            columns: ["selected_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_bans: {
        Row: {
          auth_user_id: string
          ban_group_id: string
          banned_at: string
          banned_by: string | null
          expires_at: string | null
          id: string
          lift_reason: string | null
          lifted_at: string | null
          lifted_by: string | null
          reason: string | null
          subject_type: string
          subject_value: string
        }
        Insert: {
          auth_user_id: string
          ban_group_id: string
          banned_at?: string
          banned_by?: string | null
          expires_at?: string | null
          id?: string
          lift_reason?: string | null
          lifted_at?: string | null
          lifted_by?: string | null
          reason?: string | null
          subject_type: string
          subject_value: string
        }
        Update: {
          auth_user_id?: string
          ban_group_id?: string
          banned_at?: string
          banned_by?: string | null
          expires_at?: string | null
          id?: string
          lift_reason?: string | null
          lifted_at?: string | null
          lifted_by?: string | null
          reason?: string | null
          subject_type?: string
          subject_value?: string
        }
        Relationships: []
      }
      user_briefing_state: {
        Row: {
          guild_code: string
          previous_cutoff_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          guild_code: string
          previous_cutoff_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          guild_code?: string
          previous_cutoff_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_briefing_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_token_alert_prefs: {
        Row: {
          alert_before_bomb_ready: boolean
          alert_before_bomb_ready_minutes: number
          alert_before_burn: boolean
          alert_before_burn_minutes: number
          alert_before_full: boolean
          alert_before_full_minutes: number
          alert_before_quiet_hours: boolean
          alert_before_quiet_hours_minutes: number
          alert_on_bomb_ready: boolean
          alert_on_full: boolean
          alert_on_full_repeat_hours: number | null
          alert_on_token_gained: boolean
          created_at: string
          quiet_hours_end: number | null
          quiet_hours_start: number | null
          quiet_hours_timezone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          alert_before_bomb_ready?: boolean
          alert_before_bomb_ready_minutes?: number
          alert_before_burn?: boolean
          alert_before_burn_minutes?: number
          alert_before_full?: boolean
          alert_before_full_minutes?: number
          alert_before_quiet_hours?: boolean
          alert_before_quiet_hours_minutes?: number
          alert_on_bomb_ready?: boolean
          alert_on_full?: boolean
          alert_on_full_repeat_hours?: number | null
          alert_on_token_gained?: boolean
          created_at?: string
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          quiet_hours_timezone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          alert_before_bomb_ready?: boolean
          alert_before_bomb_ready_minutes?: number
          alert_before_burn?: boolean
          alert_before_burn_minutes?: number
          alert_before_full?: boolean
          alert_before_full_minutes?: number
          alert_before_quiet_hours?: boolean
          alert_before_quiet_hours_minutes?: number
          alert_on_bomb_ready?: boolean
          alert_on_full?: boolean
          alert_on_full_repeat_hours?: number | null
          alert_on_token_gained?: boolean
          created_at?: string
          quiet_hours_end?: number | null
          quiet_hours_start?: number | null
          quiet_hours_timezone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_token_alert_prefs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      user_token_alert_state: {
        Row: {
          capped_since: string | null
          consecutive_dm_failures: number
          dm_blocked_at: string | null
          dm_channel_id: string | null
          dm_channel_recipient_id: string | null
          last_bomb_prewarn_alert_at: string | null
          last_bomb_ready_alert_at: string | null
          last_bombs: number | null
          last_burn_prewarn_alert_at: string | null
          last_full_alert_at: string | null
          last_gain_alert_at: string | null
          last_pre_quiet_alert_at: string | null
          last_prewarn_alert_at: string | null
          last_scan_at: string | null
          last_time_to_bomb_seconds: number | null
          last_time_to_full_seconds: number | null
          last_tokens: number | null
          quiet_hours_deferred_since: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          capped_since?: string | null
          consecutive_dm_failures?: number
          dm_blocked_at?: string | null
          dm_channel_id?: string | null
          dm_channel_recipient_id?: string | null
          last_bomb_prewarn_alert_at?: string | null
          last_bomb_ready_alert_at?: string | null
          last_bombs?: number | null
          last_burn_prewarn_alert_at?: string | null
          last_full_alert_at?: string | null
          last_gain_alert_at?: string | null
          last_pre_quiet_alert_at?: string | null
          last_prewarn_alert_at?: string | null
          last_scan_at?: string | null
          last_time_to_bomb_seconds?: number | null
          last_time_to_full_seconds?: number | null
          last_tokens?: number | null
          quiet_hours_deferred_since?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          capped_since?: string | null
          consecutive_dm_failures?: number
          dm_blocked_at?: string | null
          dm_channel_id?: string | null
          dm_channel_recipient_id?: string | null
          last_bomb_prewarn_alert_at?: string | null
          last_bomb_ready_alert_at?: string | null
          last_bombs?: number | null
          last_burn_prewarn_alert_at?: string | null
          last_full_alert_at?: string | null
          last_gain_alert_at?: string | null
          last_pre_quiet_alert_at?: string | null
          last_prewarn_alert_at?: string | null
          last_scan_at?: string | null
          last_time_to_bomb_seconds?: number | null
          last_time_to_full_seconds?: number | null
          last_tokens?: number | null
          quiet_hours_deferred_since?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_token_alert_state_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      votlw_winners: {
        Row: {
          bomb_bonus_points: number | null
          bronze_medals: number | null
          calculated_at: string | null
          gold_medals: number | null
          guild_code: string
          kill_bonus_points: number | null
          season: string
          silver_medals: number | null
          total_points: number
          winner_name: string
        }
        Insert: {
          bomb_bonus_points?: number | null
          bronze_medals?: number | null
          calculated_at?: string | null
          gold_medals?: number | null
          guild_code: string
          kill_bonus_points?: number | null
          season: string
          silver_medals?: number | null
          total_points: number
          winner_name: string
        }
        Update: {
          bomb_bonus_points?: number | null
          bronze_medals?: number | null
          calculated_at?: string | null
          gold_medals?: number | null
          guild_code?: string
          kill_bonus_points?: number | null
          season?: string
          silver_medals?: number | null
          total_points?: number
          winner_name?: string
        }
        Relationships: []
      }
      war_player_lineups: {
        Row: {
          created_at: string | null
          guild_code: string
          heroes: string[] | null
          id: string
          lineup_name: string
          lineup_type: string
          machine_of_war: string | null
          notes: string | null
          slot_number: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          guild_code: string
          heroes?: string[] | null
          id?: string
          lineup_name?: string
          lineup_type: string
          machine_of_war?: string | null
          notes?: string | null
          slot_number: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          guild_code?: string
          heroes?: string[] | null
          id?: string
          lineup_name?: string
          lineup_type?: string
          machine_of_war?: string | null
          notes?: string | null
          slot_number?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "war_player_lineups_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "war_player_lineups_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "war_player_lineups_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "war_player_lineups_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      webhook_config: {
        Row: {
          cluster_id: string | null
          created_at: string | null
          description: string | null
          enabled: boolean | null
          guild_code: string | null
          id: string
          last_tested: string | null
          thread_id: string | null
          updated_at: string | null
          updated_by: string | null
          webhook_type: string
          webhook_url: string | null
        }
        Insert: {
          cluster_id?: string | null
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          guild_code?: string | null
          id?: string
          last_tested?: string | null
          thread_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          webhook_type: string
          webhook_url?: string | null
        }
        Update: {
          cluster_id?: string | null
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          guild_code?: string | null
          id?: string
          last_tested?: string | null
          thread_id?: string | null
          updated_at?: string | null
          updated_by?: string | null
          webhook_type?: string
          webhook_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "webhook_config_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "cluster_config"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_config_cluster_id_fkey"
            columns: ["cluster_id"]
            isOneToOne: false
            referencedRelation: "clusters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_config_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "webhook_config_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "webhook_config_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "webhook_config_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      webhook_cron_jobs: {
        Row: {
          created_at: string | null
          enabled: boolean | null
          function_name: string
          id: string
          job_name: string
          last_run: string | null
          next_run: string | null
          schedule: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean | null
          function_name: string
          id?: string
          job_name: string
          last_run?: string | null
          next_run?: string | null
          schedule: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          enabled?: boolean | null
          function_name?: string
          id?: string
          job_name?: string
          last_run?: string | null
          next_run?: string | null
          schedule?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      work_queue: {
        Row: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          dedupe_key: string
          error: string | null
          id: number
          job_class: string
          job_type: string
          max_attempts: number
          payload: Json
          priority: number
          scheduled_for: string
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          dedupe_key: string
          error?: string | null
          id?: number
          job_class: string
          job_type: string
          max_attempts?: number
          payload?: Json
          priority?: number
          scheduled_for?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          created_at?: string
          dedupe_key?: string
          error?: string | null
          id?: number
          job_class?: string
          job_type?: string
          max_attempts?: number
          payload?: Json
          priority?: number
          scheduled_for?: string
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      write_queue: {
        Row: {
          attempts: number
          circuit_name: string | null
          completed_at: string | null
          context: Json | null
          created_at: string
          error_log: Json | null
          expires_at: string | null
          id: string
          last_error: string | null
          max_attempts: number
          operation_type: string
          payload: Json
          priority: number
          queued_at: string
          rpc_name: string | null
          rpc_params: Json | null
          scheduled_for: string
          started_at: string | null
          status: string
          target_table: string
          updated_at: string
          worker_id: string | null
        }
        Insert: {
          attempts?: number
          circuit_name?: string | null
          completed_at?: string | null
          context?: Json | null
          created_at?: string
          error_log?: Json | null
          expires_at?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          operation_type: string
          payload?: Json
          priority?: number
          queued_at?: string
          rpc_name?: string | null
          rpc_params?: Json | null
          scheduled_for?: string
          started_at?: string | null
          status?: string
          target_table: string
          updated_at?: string
          worker_id?: string | null
        }
        Update: {
          attempts?: number
          circuit_name?: string | null
          completed_at?: string | null
          context?: Json | null
          created_at?: string
          error_log?: Json | null
          expires_at?: string | null
          id?: string
          last_error?: string | null
          max_attempts?: number
          operation_type?: string
          payload?: Json
          priority?: number
          queued_at?: string
          rpc_name?: string | null
          rpc_params?: Json | null
          scheduled_for?: string
          started_at?: string | null
          status?: string
          target_table?: string
          updated_at?: string
          worker_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      api_key_coverage: {
        Row: {
          active_players: number | null
          cluster_code: string | null
          coverage_percentage: number | null
          guild_api_status: string | null
          guild_code: string | null
          guild_name: string | null
          invalid_keys: number | null
          last_verified: string | null
          players_claimed: number | null
          players_with_api_key: number | null
          total_players: number | null
          valid_keys: number | null
        }
        Relationships: []
      }
      auth_user_emails: {
        Row: {
          email: string | null
          user_id: string | null
        }
        Insert: {
          email?: string | null
          user_id?: string | null
        }
        Update: {
          email?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      boss_identifiers: {
        Row: {
          asset_slug: string | null
          boss_name: string | null
          boss_type: string | null
          encounter_index: number | null
          icon_path: string | null
          id: number | null
          map_display_name: string | null
          portrait_path: string | null
          thumbnail_path: string | null
          unit_id: string | null
        }
        Insert: {
          asset_slug?: string | null
          boss_name?: string | null
          boss_type?: string | null
          encounter_index?: number | null
          icon_path?: string | null
          id?: number | null
          map_display_name?: string | null
          portrait_path?: string | null
          thumbnail_path?: string | null
          unit_id?: string | null
        }
        Update: {
          asset_slug?: string | null
          boss_name?: string | null
          boss_type?: string | null
          encounter_index?: number | null
          icon_path?: string | null
          id?: number | null
          map_display_name?: string | null
          portrait_path?: string | null
          thumbnail_path?: string | null
          unit_id?: string | null
        }
        Relationships: []
      }
      boss_leaderboard_canonical: {
        Row: {
          boss_name: string | null
          boss_unit_id: string | null
          damage: number | null
          encounter_id: number | null
          guild_code: string | null
          hero_details: string | null
          max_hp: number | null
          mow_details: string | null
          player_name: string | null
          rarity: string | null
          remaining_hp: number | null
          season: string | null
          set: number | null
        }
        Insert: {
          boss_name?: never
          boss_unit_id?: never
          damage?: number | null
          encounter_id?: number | null
          guild_code?: string | null
          hero_details?: string | null
          max_hp?: number | null
          mow_details?: string | null
          player_name?: string | null
          rarity?: string | null
          remaining_hp?: number | null
          season?: string | null
          set?: number | null
        }
        Update: {
          boss_name?: never
          boss_unit_id?: never
          damage?: number | null
          encounter_id?: number | null
          guild_code?: string | null
          hero_details?: string | null
          max_hp?: number | null
          mow_details?: string | null
          player_name?: string | null
          rarity?: string | null
          remaining_hp?: number | null
          season?: string | null
          set?: number | null
        }
        Relationships: []
      }
      cluster_config: {
        Row: {
          cluster_code: string | null
          created_at: string | null
          display_name: string | null
          id: string | null
          is_active: boolean | null
          updated_at: string | null
        }
        Insert: {
          cluster_code?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          is_active?: boolean | null
          updated_at?: string | null
        }
        Update: {
          cluster_code?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          is_active?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      clusters_public: {
        Row: {
          cluster_code: string | null
          guild_count: number | null
        }
        Relationships: []
      }
      current_guild_boss_season_rotation: {
        Row: {
          current_bosses: Json | null
          current_config_id: string | null
          error_reason: string | null
          id: string | null
          matches: number | null
          next_bosses: Json | null
          next_config_id: string | null
          notes: string | null
          observed_bosses: Json | null
          resolved_at: string | null
          season_number: number | null
          source: string | null
        }
        Relationships: []
      }
      global_leaderboard: {
        Row: {
          avg_damage: number | null
          battle_count: number | null
          cluster_display_name: string | null
          display_name: string | null
          guild_code: string | null
          guild_display_name: string | null
          max_damage: number | null
          performance_score: number | null
          rank: number | null
          total_damage: number | null
        }
        Relationships: []
      }
      guild_veterans_count: {
        Row: {
          guild_code: string | null
          veteran_count: number | null
        }
        Relationships: []
      }
      guild_war_player_attempts_view: {
        Row: {
          attacker_guild_name: string | null
          attacker_team_index: number | null
          attacker_units_json: Json | null
          attempt_debuff: number | null
          attempt_end_time: string | null
          attempt_number: number | null
          attempt_result: string | null
          attempt_start_time: string | null
          attempt_status: string | null
          battle_duration: number | null
          created_at: string | null
          damage_dealt: number | null
          defender_guild_name: string | null
          defender_player_id: string | null
          defender_player_name: string | null
          defender_units_json: Json | null
          guild_code: string | null
          id: string | null
          is_guild_member: boolean | null
          player_id: string | null
          player_name: string | null
          raw_loki_data: Json | null
          score_earned: number | null
          units_used: Json | null
          updated_at: string | null
          war_id: string | null
          zone_id: string | null
        }
        Insert: {
          attacker_guild_name?: string | null
          attacker_team_index?: number | null
          attacker_units_json?: Json | null
          attempt_debuff?: number | null
          attempt_end_time?: string | null
          attempt_number?: number | null
          attempt_result?: string | null
          attempt_start_time?: string | null
          attempt_status?: string | null
          battle_duration?: number | null
          created_at?: string | null
          damage_dealt?: number | null
          defender_guild_name?: string | null
          defender_player_id?: string | null
          defender_player_name?: string | null
          defender_units_json?: Json | null
          guild_code?: string | null
          id?: string | null
          is_guild_member?: boolean | null
          player_id?: string | null
          player_name?: string | null
          raw_loki_data?: Json | null
          score_earned?: number | null
          units_used?: Json | null
          updated_at?: string | null
          war_id?: string | null
          zone_id?: string | null
        }
        Update: {
          attacker_guild_name?: string | null
          attacker_team_index?: number | null
          attacker_units_json?: Json | null
          attempt_debuff?: number | null
          attempt_end_time?: string | null
          attempt_number?: number | null
          attempt_result?: string | null
          attempt_start_time?: string | null
          attempt_status?: string | null
          battle_duration?: number | null
          created_at?: string | null
          damage_dealt?: number | null
          defender_guild_name?: string | null
          defender_player_id?: string | null
          defender_player_name?: string | null
          defender_units_json?: Json | null
          guild_code?: string | null
          id?: string | null
          is_guild_member?: boolean | null
          player_id?: string | null
          player_name?: string | null
          raw_loki_data?: Json | null
          score_earned?: number | null
          units_used?: Json | null
          updated_at?: string | null
          war_id?: string | null
          zone_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guild_war_battles_war_id_guild_code_fkey"
            columns: ["war_id", "guild_code"]
            isOneToOne: false
            referencedRelation: "guild_war_matches"
            referencedColumns: ["war_id", "guild_code"]
          },
          {
            foreignKeyName: "guild_war_battles_zone_id_fkey"
            columns: ["zone_id"]
            isOneToOne: false
            referencedRelation: "guild_war_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      guilds_public: {
        Row: {
          cluster_code: string | null
          guild_code: string | null
          guild_name: string | null
          is_active: boolean | null
        }
        Insert: {
          cluster_code?: string | null
          guild_code?: string | null
          guild_name?: string | null
          is_active?: boolean | null
        }
        Update: {
          cluster_code?: string | null
          guild_code?: string | null
          guild_name?: string | null
          is_active?: boolean | null
        }
        Relationships: []
      }
      member_stats_summary: {
        Row: {
          avg_damage: number | null
          boss_kills: number | null
          displayName: string | null
          Guild: string | null
          max_damage: number | null
          Season: string | null
          total_battles: number | null
          total_bombs: number | null
          total_damage: number | null
          unique_bosses_fought: number | null
        }
        Relationships: []
      }
      meta_atlas_by_unit: {
        Row: {
          attack_count: number | null
          boss_unit_id: string | null
          damage_avg: number | null
          damage_max: number | null
          damage_p75: number | null
          damage_p90: number | null
          map_id: string | null
          meta_team: string | null
          rarity: string | null
          set_num: number | null
          team_composition: string | null
          team_hash: string | null
          unit_type: string | null
        }
        Insert: {
          attack_count?: number | null
          boss_unit_id?: string | null
          damage_avg?: number | null
          damage_max?: number | null
          damage_p75?: number | null
          damage_p90?: number | null
          map_id?: string | null
          meta_team?: string | null
          rarity?: string | null
          set_num?: number | null
          team_composition?: string | null
          team_hash?: string | null
          unit_type?: never
        }
        Update: {
          attack_count?: number | null
          boss_unit_id?: string | null
          damage_avg?: number | null
          damage_max?: number | null
          damage_p75?: number | null
          damage_p90?: number | null
          map_id?: string | null
          meta_team?: string | null
          rarity?: string | null
          set_num?: number | null
          team_composition?: string | null
          team_hash?: string | null
          unit_type?: never
        }
        Relationships: []
      }
      meta_atlas_by_unit_type: {
        Row: {
          attack_count: number | null
          damage_avg: number | null
          damage_max: number | null
          damage_p75: number | null
          damage_p90: number | null
          maps_seen: string[] | null
          meta_team: string | null
          rarity: string | null
          set_num: number | null
          team_composition: string | null
          team_hash: string | null
          unit_type: string | null
        }
        Relationships: []
      }
      mv_boss_performance: {
        Row: {
          attempt_count: number | null
          avg_damage: number | null
          boss_name: string | null
          cluster_code: string | null
          damageType: string | null
          kills: number | null
          max_damage: number | null
          median_damage: number | null
          min_damage: number | null
          one_shots: number | null
          rarity: string | null
          Season: string | null
          unique_players: number | null
        }
        Relationships: []
      }
      mv_cluster_boss_averages: {
        Row: {
          battle_count: number | null
          boss_name: string | null
          cluster_avg: number | null
          cluster_code: string | null
          encounterId: number | null
          rarity: string | null
          Season: string | null
          set: number | null
        }
        Relationships: []
      }
      mv_cluster_season_rankings: {
        Row: {
          battle_count: number | null
          cluster_code: string | null
          display_name: string | null
          guild: string | null
          percent_vs_cluster: number | null
          season: string | null
          season_rank: number | null
          stable_key: string | null
        }
        Relationships: []
      }
      mv_global_leaderboard: {
        Row: {
          avg_damage: number | null
          battle_count: number | null
          bombs_used: number | null
          cluster_code: string | null
          cluster_rank: number | null
          global_rank: number | null
          Guild: string | null
          guild_rank: number | null
          last_updated: string | null
          player_id: string | null
          player_name: string | null
          rarity: string | null
          Season: string | null
          total_damage: number | null
        }
        Relationships: []
      }
      mv_guild_performance_cache: {
        Row: {
          avg_damage: number | null
          cluster_code: string | null
          cluster_rank: number | null
          global_rank: number | null
          Guild: string | null
          last_updated: string | null
          median_damage: number | null
          Season: string | null
          total_battles: number | null
          total_damage: number | null
          unique_players: number | null
        }
        Relationships: []
      }
      mv_public_stats: {
        Row: {
          cached_at: string | null
          s: Json | null
        }
        Relationships: []
      }
      mv_season_summary: {
        Row: {
          avg_damage: number | null
          cluster_code: string | null
          completed_battles: number | null
          Guild: string | null
          last_activity: string | null
          one_shots: number | null
          player_count: number | null
          Season: string | null
          total_battles: number | null
          total_damage: number | null
          unique_bosses: number | null
        }
        Relationships: []
      }
      player_architecture_health: {
        Row: {
          metric: string | null
          unit: string | null
          value: string | null
        }
        Relationships: []
      }
      player_performance_summary: {
        Row: {
          avg_damage: number | null
          battle_count: number | null
          cluster_code: string | null
          cluster_rank: number | null
          Guild: string | null
          guild_rank: number | null
          max_damage: number | null
          performance_tier: string | null
          player_id: string | null
          player_name: string | null
          Season: string | null
          total_damage: number | null
          unique_bosses: number | null
        }
        Relationships: []
      }
      player_with_cluster: {
        Row: {
          api_key_is_valid: boolean | null
          auto_generated: boolean | null
          cluster_code: string | null
          cluster_display_name: string | null
          cluster_id: string | null
          cluster_is_active: boolean | null
          display_name: string | null
          guild_code: string | null
          guild_display_name: string | null
          is_current: boolean | null
          last_sync_at: string | null
          last_sync_bombs: number | null
          last_sync_tokens: number | null
          next_bomb_seconds: number | null
          next_token_seconds: number | null
          player_id: string | null
          primary_boss: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          secondary_boss: string | null
          tacticus_api_key_encrypted: string | null
          theme_preference: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_mapping_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "player_mapping_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "player_mapping_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "player_mapping_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
      // Manual stub for the privacy-enforcing public_guild_snapshots_explore view.
      // showcase_enabled and recruitment_status exist only on live (not in the
      // baseline), so gen-types never saw them. Replace on the next regeneration.
      public_guild_snapshots_explore: {
        Row: {
          active_players: number | null
          average_damage: number | null
          avg_damage_per_battle: number | null
          cluster_code: string | null
          cluster_name: string | null
          // Nullable on the view: obfuscating rows get NULL because the band width
          // helps invert the perturbation.
          explore_obfuscation_percent: number | null
          explore_privacy_mode: Json | null
          guild_code: string
          guild_name: string | null
          guild_tag: string | null
          last_updated: string | null
          member_count: number | null
          rank: number | null
          recruitment_status: string | null
          season: number
          showcase_enabled: boolean | null
          top_boss_hits: Json | null
          total_battles: number | null
          total_damage: number | null
          veteran_count: number | null
          votlw_champions: Json | null
          votlw_count: number | null
          war_rank: number | null
        }
        Relationships: []
      }
      season_token_usage: {
        Row: {
          cluster_code: string | null
          display_name: string | null
          first_token_time: string | null
          guild_code: string | null
          last_token_time: string | null
          max_possible_tokens: number | null
          regen_interval_hours: number | null
          regen_tokens_per_interval: number | null
          season_id: string | null
          tokens_missing: number | null
          tokens_used: number | null
        }
        Relationships: []
      }
      user_profiles_with_guild: {
        Row: {
          avatar_url: string | null
          discord_username: string | null
          display_name: string | null
          guild_code: string | null
          guild_name: string | null
          id: number | null
          is_active: boolean | null
          joined_at: string | null
          role: Database["public"]["Enums"]["app_role"] | null
          user_id: string | null
          username: string | null
        }
        Relationships: [
          {
            foreignKeyName: "player_mapping_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "api_key_coverage"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "player_mapping_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guild_config"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "player_mapping_guild_code_fkey"
            columns: ["guild_code"]
            isOneToOne: false
            referencedRelation: "guilds_public"
            referencedColumns: ["guild_code"]
          },
          {
            foreignKeyName: "player_mapping_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "auth_user_emails"
            referencedColumns: ["user_id"]
          },
        ]
      }
    }
    Functions: {
      _pm_caller_can_manage_player_meta: {
        Args: { p_target_user_id: string }
        Returns: boolean
      }
      _pm_caller_cluster_guild_codes: { Args: never; Returns: string[] }
      _pm_caller_guild_codes: { Args: never; Returns: string[] }
      _pm_caller_is_app_admin: { Args: never; Returns: boolean }
      _pm_caller_mapping_rows: {
        Args: never
        Returns: {
          cluster_code: string
          guild_code: string
          is_app_admin: boolean
          is_current: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      activate_discord_identity_generation: {
        Args: { p_relink_nonce: string; p_unlink_id: string }
        Returns: Json
      }
      begin_guild_roster_observation: { Args: never; Returns: string }
      begin_own_guild_onboarding_attempt: {
        Args: { p_subject: string }
        Returns: number
      }
      add_column_if_not_exists: {
        Args: {
          p_column_definition: string
          p_column_name: string
          p_table_name: string
        }
        Returns: undefined
      }
      add_guild_to_cluster:
        | {
            Args: {
              p_cluster_code: string
              p_display_name: string
              p_guild_code: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_api_key?: string
              p_cluster_code: string
              p_display_name: string
              p_guild_code: string
            }
            Returns: Json
          }
      add_guild_to_cluster_safe:
        | {
            Args: {
              p_cluster_code?: string
              p_display_name: string
              p_guild_code: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_api_key?: string
              p_cluster_code?: string
              p_display_name: string
              p_guild_code: string
            }
            Returns: Json
          }
      admin_add_alpha_tester: {
        Args: { p_expires_at?: string; p_notes?: string; p_user_email: string }
        Returns: Json
      }
      admin_remove_alpha_tester: {
        Args: { p_user_email: string }
        Returns: Json
      }
      admin_update_feature_stage: {
        Args: { p_feature_key: string; p_new_stage: string }
        Returns: Json
      }
      analyze_inactive_guilds: {
        Args: never
        Returns: {
          active_members: number
          activity_score: number
          display_name: string
          enabled: boolean
          guild_code: string
          guild_id: number
          last_activity: string
          recent_battles: number
          total_members: number
        }[]
      }
      analyze_player_progression: {
        Args: { p_guild_code: string; p_player_name: string }
        Returns: {
          avg_damage: number
          guild_rank: number
          improvement_pct: number
          player_id: string
          player_name: string
          season: string
          season_rank: number
          total_battles: number
        }[]
      }
      analyze_team_composition: {
        Args: {
          p_guild_code: string
          p_hero_keys: string[]
          p_season_count?: number
        }
        Returns: {
          avg_score: number
          buff_breakdown: Json
          losses: number
          matchup_summary: Json
          total_uses: number
          win_rate: number
          wins: number
          zone_breakdown: Json
        }[]
      }
      append_player_identity_revocation: {
        Args: {
          p_actor_user_id: string
          p_attestation_id: string
          p_reason: string
          p_source: string
        }
        Returns: string
      }
      assert_matview_health: { Args: never; Returns: number }
      backfill_boss_mapping_unit_ids: {
        Args: never
        Returns: {
          boss_types_updated: string[]
          updated_count: number
        }[]
      }
      batch_categorize_teams: {
        Args: { p_teams: Json }
        Returns: {
          category: string
          hero_count: number
          team_id: string
        }[]
      }
      batch_repair_unmapped_players: {
        Args: { p_guild: string; p_user_mappings: Json }
        Returns: number
      }
      block_player_identity_subject_authority: {
        Args: { p_reason: string; p_source: string; p_user_id: string }
        Returns: string
      }
      bulk_insert_battle_data: {
        Args: { p_guild_code?: string; p_records: Json }
        Returns: {
          duplicate_count: number
          error_count: number
          inserted_count: number
        }[]
      }
      bulk_upsert_player_mappings: {
        Args: { p_mappings: Json }
        Returns: number
      }
      calc_boss_performance_pct: {
        Args: {
          p_gate_avg?: number
          p_non_sweep_count: number
          p_non_sweep_damage: number
          p_reference_avg: number
          p_sweep_damages: number[]
        }
        Returns: number
      }
      calc_effective_battle_count: {
        Args: {
          p_gate_avg?: number
          p_non_sweep_count: number
          p_reference_avg: number
          p_sweep_damages: number[]
        }
        Returns: number
      }
      calculate_player_reliability: {
        Args: {
          p_cluster_code?: string
          p_guild_code: string
          p_season: string
          p_user_id: string
        }
        Returns: {
          avg_performance: number
          battles_analyzed: number
          coefficient_of_variation: number
          consistency_rating: string
          performance_range_max: number
          performance_range_min: number
          performance_stddev: number
          reliability_score: number
        }[]
      }
      calculate_player_tokens: {
        Args: { p_guild_code: string; p_player_name: string; p_season?: string }
        Returns: {
          battles_today: number
          guild_code: string
          is_capped: boolean
          last_battle_time: string
          player_name: string
          time_until_next_token: string
          tokens_available: number
        }[]
      }
      calculate_player_tokens_by_user: {
        Args: { p_guild_code: string; p_season?: string; p_user_id: string }
        Returns: {
          battles_today: number
          guild_code: string
          is_capped: boolean
          last_battle_time: string
          player_user_id: string
          time_until_next_token: string
          tokens_available: number
        }[]
      }
      calculate_votlw_for_completed_seasons: {
        Args: never
        Returns: {
          message: string
          seasons_processed: number[]
        }[]
      }
      calculate_votlw_for_season: {
        Args: { p_guild?: string; p_season?: string }
        Returns: Json
      }
      calculate_votlw_if_scheduled: { Args: never; Returns: undefined }
      call_edge_function: {
        Args: { function_name: string; payload?: Json }
        Returns: Json
      }
      can_author_playbooks: { Args: { p_user_id: string }; Returns: boolean }
      can_edit_playbook_row: {
        Args: {
          p_cluster_code: string
          p_guild_code: string
          p_user_id: string
        }
        Returns: boolean
      }
      can_edit_playbooks: { Args: { user_id: string }; Returns: boolean }
      can_upload_guild_images: { Args: { p_user_id: string }; Returns: boolean }
      can_view_assigned_playbook: {
        Args: { p_boss_id: string; p_user_id?: string }
        Returns: boolean
      }
      can_view_playbook: {
        Args: {
          p_cluster_code: string
          p_guild_code: string
          p_user_id?: string
        }
        Returns: boolean
      }
      can_view_playbook_full: {
        Args: {
          p_boss_id: string
          p_cluster_code: string
          p_guild_code: string
          p_user_id?: string
        }
        Returns: boolean
      }
      categorize_team_composition: {
        Args: { hero_names: string[] }
        Returns: string
      }
      change_own_player_account: {
        Args: { p_proof_invite_id: string }
        Returns: Json
      }
      check_database_health: { Args: never; Returns: Json }
      check_duplicate_current_records: {
        Args: never
        Returns: {
          count: number
          player_id: string
        }[]
      }
      check_feature_access: {
        Args: { p_feature_key: string; p_user_id: string }
        Returns: Json
      }
      check_guild_exists: { Args: { p_guild_code: string }; Returns: boolean }
      check_guild_registration_status: {
        Args: { guild_code_param: string }
        Returns: {
          can_resume: boolean
          guild_exists: boolean
          registration_age_hours: number
          registration_status: string
        }[]
      }
      check_guild_roster_write_health: {
        Args: {
          p_min_current_rows?: number
          p_min_fresh_fraction?: number
          p_quiet?: boolean
          p_stale_days?: number
        }
        Returns: number
      }
      check_http_response_errors: { Args: never; Returns: undefined }
      check_log_export_cooldown: {
        Args: { p_guild_code: string }
        Returns: {
          can_export: boolean
          last_export: string
          message: string
          next_available: string
        }[]
      }
      check_pgnet_freshness: { Args: never; Returns: undefined }
      check_votlw_data_freshness: {
        Args: never
        Returns: {
          current_season: number
          last_votlw_season: number
          message: string
          needs_update: boolean
          status: string
        }[]
      }
      claim_gdpr_export_redrive: {
        Args: { p_request_id: string; p_stuck_export_minutes?: number }
        Returns: boolean
      }
      claim_next_job: {
        Args: { p_job_types?: string[]; p_worker_id: string }
        Returns: {
          attempts: number | null
          completed_at: string | null
          created_at: string | null
          error_log: Json | null
          guild_code: string
          id: string
          job_type: string
          max_attempts: number | null
          payload: Json | null
          priority: number
          progress: Json | null
          scheduled_for: string | null
          started_at: string | null
          status: string
          updated_at: string | null
          worker_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "sync_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_next_work_job: {
        Args: { p_classes: string[]; p_worker_id: string }
        Returns: {
          attempts: number
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          created_at: string
          dedupe_key: string
          error: string | null
          id: number
          job_class: string
          job_type: string
          max_attempts: number
          payload: Json
          priority: number
          scheduled_for: string
          started_at: string | null
          status: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "work_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      enqueue_user_ban_reconciliation_jobs: {
        Args: { p_jobs: Json }
        Returns: number
      }
      claim_write_job: {
        Args: { p_circuit_name?: string; p_worker_id: string }
        Returns: {
          attempts: number
          circuit_name: string | null
          completed_at: string | null
          context: Json | null
          created_at: string
          error_log: Json | null
          expires_at: string | null
          id: string
          last_error: string | null
          max_attempts: number
          operation_type: string
          payload: Json
          priority: number
          queued_at: string
          rpc_name: string | null
          rpc_params: Json | null
          scheduled_for: string
          started_at: string | null
          status: string
          target_table: string
          updated_at: string
          worker_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "write_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cleanup_abandoned_onboarding: {
        Args: { p_dry_run?: boolean; p_hours_threshold?: number }
        Returns: {
          code: string
          hours_since_start: number
          name: string
          type: string
        }[]
      }
      cleanup_discord_webhook_logs: { Args: never; Returns: number }
      cleanup_expired_coaching_task_deliveries_v1: {
        Args: { p_batch_size?: number }
        Returns: number
      }
      cleanup_expired_gdpr_data: { Args: never; Returns: number }
      cleanup_incomplete_registrations: {
        Args: never
        Returns: {
          cleaned_count: number
          guild_codes: string[]
        }[]
      }
      cleanup_old_sync_data: { Args: never; Returns: number }
      cleanup_orphaned_guilds: {
        Args: never
        Returns: {
          cleaned_count: number
          guild_codes: string[]
        }[]
      }
      cleanup_work_queue: { Args: never; Returns: number }
      cleanup_write_queue: {
        Args: { p_completed_retention?: string; p_failed_retention?: string }
        Returns: number
      }
      clear_season_assignments: {
        Args: { p_guild_code: string; p_season_number: string }
        Returns: Json
      }
      compare_guilds: {
        Args: { p_guilds: string[]; p_season?: string }
        Returns: {
          damage_types_used: string[]
          Guild: string
          guild_avg_damage_per_hit: number
          guild_avg_damage_per_player: number
          guild_total_damage: number
          max_loop_reached: number
          player_count: number
          Season: string
          unique_bosses_hit: number
        }[]
      }
      complete_coaching_task_delivery_v1: {
        Args: {
          p_actor_user_id: string
          p_delivery_id: string
          p_error_code?: string
          p_provider_status?: number
          p_status: string
        }
        Returns: {
          completed_at: string
          delivery_id: string
          delivery_status: string
          error_code: string
          provider_status: number
          request_id: string
        }[]
      }
      complete_job: {
        Args: {
          p_job_id: string
          p_metrics?: Json
          p_progress?: Json
          p_worker_id: string
        }
        Returns: boolean
      }
      complete_work_job: {
        Args: { p_job_id: number; p_result?: Json; p_worker_id: string }
        Returns: boolean
      }
      complete_write_job: {
        Args: { p_error?: string; p_job_id: string; p_success?: boolean }
        Returns: boolean
      }
      compute_player_token_burn: {
        Args: {
          p_guild_code: string
          p_now?: string
          p_player_id: string
          p_season: string
        }
        Returns: {
          burned_tokens: number
          time_over_cap_seconds: number
        }[]
      }
      compute_player_tokens_available: {
        Args: {
          p_guild_code: string
          p_now?: string
          p_player_id: string
          p_season: string
        }
        Returns: {
          token_next_in_seconds: number
          tokens_available: number
        }[]
      }
      confirm_discord_identity_unlink: {
        Args: { p_unlink_id: string }
        Returns: Json
      }
      count_veteran_players: {
        Args: { p_guild_code: string }
        Returns: {
          total_veterans: number
          veteran_details: Json
        }[]
      }
      create_player_invite_code: {
        Args: { p_expires_at: string; p_mapping_id: number }
        Returns: Json
      }
      current_user_id: { Args: never; Returns: string }
      debug_auth_system: {
        Args: { p_player_id?: string; p_user_id?: string }
        Returns: Json
      }
      debug_jwt_claims: { Args: never; Returns: Json }
      debug_player_duplicates: {
        Args: { p_guild_code?: string }
        Returns: {
          battle_counts: number[]
          display_names: string[]
          player_ids: string[]
          seasons_active: string[]
          suspected_player: string
        }[]
      }
      deactivate_player_mappings: {
        Args: {
          p_guild_code: string
          p_player_ids: string[]
          p_reason: string
          p_source: string
        }
        Returns: Json
      }
      deactivate_player_mappings_legacy_impl: {
        Args: {
          p_guild_code: string
          p_observed_at: string
          p_player_ids: string[]
          p_reason: string
          p_source: string
        }
        Returns: Json
      }
      deactivate_player_mappings_observed: {
        Args: {
          p_guild_code: string
          p_observed_at: string
          p_player_ids: string[]
          p_reason: string
          p_source: string
        }
        Returns: Json
      }
      delete_player_guild: {
        Args: { p_guild_id: number; p_reason: string; p_source: string }
        Returns: Json
      }
      delete_user_profile: { Args: { user_id: string }; Returns: undefined }
      diagnose_profile_claim_issues: {
        Args: { p_player_id: string }
        Returns: {
          details: string
          issue_type: string
          suggested_fix: string
        }[]
      }
      dispatch_token_notification_events_discord: {
        Args: {
          p_max_events_per_guild?: number
          p_max_guilds?: number
          p_now?: string
        }
        Returns: {
          failed_events: number
          guild_code: string
          processed_events: number
          sent_events: number
          skipped_events: number
        }[]
      }
      enforce_request_user_ban: { Args: never; Returns: undefined }
      enqueue_sync: {
        Args: {
          p_guild_code: string
          p_job_type?: string
          p_priority?: number
          p_scheduled_for?: string
        }
        Returns: string
      }
      enqueue_write: {
        Args: {
          p_circuit_name?: string
          p_context?: Json
          p_expires_in?: string
          p_max_attempts?: number
          p_operation_type: string
          p_payload: Json
          p_priority?: number
          p_target_table: string
        }
        Returns: string
      }
      expire_ended_trials: { Args: never; Returns: number }
      export_meta_atlas_for_modeling: {
        Args: { p_min_attacks?: number; p_seasons?: string[] }
        Returns: {
          boss_rarity: string
          boss_set_num: number
          boss_type: string
          boss_unit_id: string
          damage_100th: number
          damage_75th: number
          damage_90th: number
          damage_average: number
          encounter_type: string
          meta_team: string
          num_attacks: number
          rarity_set: string
          season_number: string
          sub_boss_name: string
          team_composition: string
          team_hash: string
        }[]
      }
      extract_map_from_unit_id: { Args: { p_unit_id: string }; Returns: string }
      extract_unit_type_from_unit_id: {
        Args: { p_unit_id: string }
        Returns: string
      }
      fail_job: {
        Args: {
          p_error: string
          p_job_id: string
          p_progress?: Json
          p_worker_id: string
        }
        Returns: boolean
      }
      fail_work_job: {
        Args: {
          p_backoff_seconds?: number
          p_error: string
          p_job_id: number
          p_worker_id: string
        }
        Returns: boolean
      }
      fetch_raw_tacticus_data: { Args: never; Returns: undefined }
      find_orphaned_player_mappings: {
        Args: never
        Returns: {
          created_at: string
          display_name: string
          guild_code: string
          is_current: boolean
          player_id: string
          user_id: string
        }[]
      }
      find_token_accrual_violations: {
        Args: { p_guild_code?: string }
        Returns: {
          display_name: string
          excess: number
          guild_code: string
          max_accruable: number
          player_id: string
          season: string
          tokens_available: number
          tokens_used: number
        }[]
      }
      find_unmapped_players_optimized: {
        Args: never
        Returns: {
          guild_code: string
          record_count: number
          user_id: string
        }[]
      }
      fix_duplicate_current_mappings: {
        Args: never
        Returns: {
          disabled_guilds: string
          fixed_display_name: string
          fixed_player_id: string
          kept_guild: string
        }[]
      }
      format_team_composition: {
        Args: { mow: string; team_comp: Json }
        Returns: string
      }
      format_team_with_emojis: {
        Args: { hero_details: string; mow_details: string }
        Returns: string
      }
      generate_boss_assignments: {
        Args: {
          p_dry_run?: boolean
          p_excluded_bosses?: string[]
          p_guild_code: string
          p_max_tokens_per_player?: number
          p_season?: string
          p_season_id?: string
          p_skip_side_bosses?: boolean
        }
        Returns: Json
      }
      generate_invite_code: { Args: never; Returns: string }
      generate_team_hash: {
        Args: { hero_details: string; mow_details: string }
        Returns: string
      }
      generate_verification_code: { Args: never; Returns: string }
      get_ability_stat: {
        Args: { ability_level: number; base_stat: number; rarity?: string }
        Returns: number
      }
      get_accurate_battle_count: {
        Args: { p_guild_code?: string }
        Returns: number
      }
      get_active_clusters: {
        Args: never
        Returns: {
          cluster_code: string
          cluster_name: string
          guild_count: number
          has_discord_webhook: boolean
        }[]
      }
      get_activity_heatmap: {
        Args: { p_days?: number; p_guild_code: string }
        Returns: {
          activity_count: number
          activity_date: string
          player_name: string
        }[]
      }
      get_admin_support_unread_count: { Args: never; Returns: number }
      get_all_boss_hp: {
        Args: { p_guild_code?: string }
        Returns: {
          boss_name: string
          encounter_id: number
          max_hp: number
          rarity: string
          set_level: number
        }[]
      }
      get_api_base_url: { Args: never; Returns: string }
      get_app_health_for_support: {
        Args: never
        Returns: {
          db_ok: boolean
          sync_recent: boolean
        }[]
      }
      get_auth_jwt: { Args: never; Returns: Json }
      get_auth_role: { Args: never; Returns: string }
      get_auth_uid: { Args: never; Returns: string }
      get_boss_best_hits: {
        Args: {
          p_cluster_code?: string
          p_guild_code?: string
          p_limit?: number
          p_rarity?: string
          p_season?: string
        }
        Returns: {
          boss_name: string
          boss_order: number
          cluster_code: string
          cluster_name: string
          damage_dealt: number
          damage_type: string
          guild_code: string
          guild_name: string
          player_name: string
          rarity: string
          set: number
          team_composition: Json
        }[]
      }
      get_boss_difficulty_analysis: {
        Args: { p_guild_code: string; p_rarities?: string[]; p_season: string }
        Returns: {
          avg_attempts: number
          avg_damage_per_attempt: number
          avg_time_minutes: number
          boss_name: string
          completed_loops: number
          completion_rate: number
          display_name: string
          encounter_id: number
          hit_count: number
          rarity: string
          set_num: number
          total_damage: number
          total_loops: number
        }[]
      }
      get_boss_encounters: {
        Args: {
          p_cluster_code?: string
          p_guild_code?: string
          p_include_primes?: boolean
        }
        Returns: {
          avg_damage: number
          boss_name: string
          champion_name: string
          cluster_code: string
          encounter_id: number
          guild_code: string
          guild_name: string
          is_prime: boolean
          level_label: string
          max_damage: number
          players_attempted: number
          rarity: string
          rarity_sort_order: number
          set: number
          times_killed: number
          total_attacks: number
          total_damage: number
        }[]
      }
      get_boss_encounters_by_cluster: {
        Args: { p_season?: string }
        Returns: {
          boss_name: string
          champion: string
          champion_guild: string
          cluster_code: string
          max_damage: number
          rarity: string
          set: number
          tokens_used: number
          total_damage: number
          unique_players: number
        }[]
      }
      get_boss_encounters_by_guild: {
        Args: { p_guild_code?: string; p_season?: string }
        Returns: {
          boss_name: string
          champion: string
          cluster_code: string
          guild_code: string
          guild_name: string
          max_damage: number
          rarity: string
          set: number
          tokens_used: number
          total_damage: number
          unique_players: number
        }[]
      }
      get_boss_encounters_cluster: {
        Args: { p_cluster_code?: string; p_season: string }
        Returns: {
          avg_damage: number
          boss_level: string
          boss_name: string
          encounter_count: number
          max_damage: number
          rarity: string
          set_number: number
          success_rate: number
          total_damage: number
          unique_players: number
        }[]
      }
      get_boss_leaderboard: {
        Args: {
          p_boss_level: string
          p_guild_code: string
          p_limit?: number
          p_season: string
        }
        Returns: {
          battle_time: string
          damage_dealt: number
          player_name: string
          rank: number
          team_composition: string[]
        }[]
      }
      get_boss_performance_overview: {
        Args: { p_guild_code: string; p_level: string; p_season: string }
        Returns: Json
      }
      get_boss_playbook: {
        Args: { p_boss_id: string }
        Returns: {
          content: string
          updated_at: string
          updated_by: string
          updater_name: string
          version: number
        }[]
      }
      get_boss_summary: {
        Args: {
          p_cluster_code?: string
          p_guild_code?: string
          p_rarity?: string
          p_season?: string
          p_tier_max?: number
          p_tier_min?: number
        }
        Returns: {
          avg_hit: number
          battle_count: number
          boss_name: string
          boss_order: number
          encounter_index: number
          loop_number: number
          max_hit: number
          rarity: string
          set: number
          sub_boss_name: string
          tier_max: number
          tier_min: number
          top_player: string
          top_player_guild: string
          total_damage: number
          unique_players: number
        }[]
      }
      get_boss_unit_id: { Args: { p_name: string }; Returns: string }
      get_checkout_session_data: {
        Args: { p_guild_code: string }
        Returns: Json
      }
      get_cluster_api_key_coverage: {
        Args: { p_cluster_code: string }
        Returns: {
          active_players: number
          coverage_percentage: number
          guild_api_status: string
          guild_code: string
          players_claimed: number
          players_with_api_key: number
          total_players: number
        }[]
      }
      get_cluster_battle_data: {
        Args: { season_num?: string }
        Returns: {
          completedOn: string
          damageDealt: number
          damageType: string
          displayName: string
          encounterId: string
          Guild: string
          heroDetails: string
          loopIndex: number
          machineOfWarDetails: string
          maxHp: number
          Name: string
          rarity: string
          remainingHp: number
          Season: string
          set: number
          startedOn: string
          tier: number
          userId: string
        }[]
      }
      get_cluster_battle_data_for_cluster: {
        Args: { p_cluster_code: string; p_season_num?: string }
        Returns: {
          completedOn: string
          damageDealt: number
          damageType: string
          displayName: string
          encounterId: string
          Guild: string
          heroDetails: string
          loopIndex: number
          machineOfWarDetails: string
          maxHp: number
          Name: string
          rarity: string
          remainingHp: number
          Season: string
          set: number
          startedOn: string
          tier: number
          userId: string
        }[]
      }
      get_cluster_boss_averages:
        | {
            Args: { p_cluster_code: string; p_season: string }
            Returns: {
              avg_damage: number
              boss_name: string
              encounter_id: number
              hit_count: number
              rarity: string
              set_num: number
            }[]
          }
        | {
            Args: { p_season: string }
            Returns: {
              boss_name: string
              cluster_avg_damage: number
              cluster_hit_count: number
              encounter_type: string
              set: number
            }[]
          }
      get_cluster_boss_avg_damage: {
        Args: {
          p_boss_name: string
          p_cluster_code: string
          p_encounter_id: number
          p_rarity: string
          p_season: string
          p_set: number
        }
        Returns: number
      }
      get_cluster_boss_matrix: {
        Args: { p_cluster_code: string; p_season: string }
        Returns: {
          boss_name: string
          encounter_id: number
          finisher_damage: number
          finisher_tokens: number
          guild_code: string
          killed: boolean
          loop_index: number
          rarity: string
          set: number
          tokens: number
          total_damage: number
        }[]
      }
      get_cluster_discord_webhooks: {
        Args: { p_cluster_code: string }
        Returns: {
          channel_name: string
          enabled: boolean
          settings: Json
          webhook_type: string
          webhook_url: string
        }[]
      }
      get_cluster_damage_rank: {
        Args: {
          p_cluster_code: string
          p_player_id: string
          p_season: string
        }
        Returns: number
      }
      get_cluster_historical_rankings: {
        Args: { p_cluster_code?: string; p_seasons: string[] }
        Returns: {
          display_name: string
          guild: string
          percent_vs_cluster: number
          season: string
          season_rank: number
          stable_key: string
        }[]
      }
      get_cluster_latest_season: { Args: never; Returns: string }
      get_cluster_overall_leaderboard: {
        Args: { p_cluster_code?: string; p_season: string }
        Returns: {
          all_battle_count: number
          all_bosses_killed: number
          avg_damage: number
          battle_count: number
          bombs_used: number
          bosses_killed: number
          current_rank: number
          display_name: string
          guild: string
          percent_vs_cluster: number
          stable_key: string
          total_damage: number
          user_id: string
        }[]
      }
      get_cluster_stats_filtered: {
        Args: { season_num?: string }
        Returns: {
          avg_damage: number
          battle_count: number
          boss_id: string
          boss_name: string
          max_damage: number
          min_damage: number
          player_count: number
          season: string
          std_dev: number
          total_damage: number
        }[]
      }
      get_command_center_cluster_guild_metadata_v1: {
        Args: never
        Returns: {
          cluster_code: string
          display_name: string
          enabled: boolean
          gr_ranking: number
          guild_code: string
          gw_ranking: number
          token_abuser_threshold: number
          token_offender_threshold: number
        }[]
      }
      get_command_center_current_boss_status_v1: {
        Args: { p_guild_code: string; p_season: string }
        Returns: {
          alive_primes: number
          boss_name: string
          completed_on: string
          encounter_id: number
          lifecycle_state: string
          loop_index: number
          max_hp: number
          rarity: string
          remaining_hp: number
          set: number
          warded: boolean
        }[]
      }
      get_command_center_guild_members_v1: {
        Args: never
        Returns: {
          assignment_updated_at: string
          avatar_unit_id: string
          display_name: string
          guild_code: string
          is_active: boolean
          is_current: boolean
          last_sync_at: string
          player_id: string
          player_level: number
          player_mapping_id: number
          primary_boss: string
          role: string
          secondary_boss: string
        }[]
      }
      get_command_center_guild_season_summary_v1: {
        Args: { p_guild_code: string; p_season: string }
        Returns: {
          avg_damage_per_hour: number
          boss_kills: number
          max_hit: number
          recent_activity: number
          total_battles: number
          total_damage: number
        }[]
      }
      get_command_center_member_season_forecast_v1: {
        Args: { p_guild_code: string; p_season_number: number }
        Returns: Json
      }
      get_command_center_member_token_state_v1: {
        Args: { p_season: string }
        Returns: {
          bomb_next_in_seconds: number
          bombs_available: number
          burned_tokens: number
          data_source: string
          is_capped: boolean
          last_battle_time: string
          last_sync_at: string
          max_possible: number
          player_mapping_id: number
          post_snapshot_spends: number
          time_over_cap_seconds: number
          time_to_next_token: string
          token_next_in_seconds: number
          tokens_available: number
          tokens_used: number
        }[]
      }
      get_command_center_officer_boss_performance_v1: {
        Args: {
          p_boss_name: string
          p_guild_code: string
          p_player_mapping_ids: number[]
          p_rarity: string
          p_season: string
          p_sets: number[]
        }
        Returns: {
          battle_count: number
          biggest_hit: number
          boss_name: string
          boss_preference: string
          cluster_avg: number
          display_name: string
          encounter_id: number
          guild_avg: number
          player_avg: number
          player_mapping_id: number
          rarity: string
          set_num: number
          tier: number
          vs_cluster_pct: number
          vs_guild_pct: number
          weighted_contribution: number
        }[]
      }
      get_command_center_officer_performance_summary_v1: {
        Args: {
          p_guild_code: string
          p_player_mapping_ids: number[]
          p_season: string
        }
        Returns: {
          avg_vs_cluster: number
          avg_vs_cluster_boss_only: number
          avg_vs_guild: number
          avg_vs_guild_boss_only: number
          boss_hits: number
          bosses_played: number
          display_name: string
          player_mapping_id: number
          prime_hits: number
          primes_played: number
          total_battles: number
        }[]
      }
      get_command_center_officer_roster_v1: {
        Args: { p_guild_code: string; p_unit_ids: string[] }
        Returns: {
          active_ability_level: number
          category: string
          guild_role: string
          hero_display_name: string
          passive_ability_level: number
          player_display_name: string
          player_mapping_id: number
          progression_index: number
          rank_name: string
          rarity: string
          stars: number
          synced_at: string
          unit_id: string
          web_icon_url: string
          xp_level: number
        }[]
      }
      get_command_center_officer_season_forecast_v1: {
        Args: { p_guild_code: string; p_season_number: number }
        Returns: Json
      }
      get_command_center_officer_team_usage_v1: {
        Args: {
          p_boss_name: string
          p_guild_code: string
          p_player_mapping_ids: number[]
          p_rarity_set: string
          p_season: string
        }
        Returns: {
          attack_count: number
          avg_damage: number
          boss_name: string
          boss_type: string
          display_name: string
          encounter_index: number
          encounter_type: string
          meta_team: string
          player_mapping_id: number
          rarity: string
          rarity_set: string
          set_num: number
          team_composition: string
          team_hash: string
        }[]
      }
      get_command_center_officer_token_summary_v1: {
        Args: { p_guild_code: string; p_season: string }
        Returns: {
          bosses_assigned: number
          display_name: string
          max_tokens_allowed: number
          player_mapping_id: number
          token_allocations: Json
          total_tokens_used: number
        }[]
      }
      get_command_center_officer_token_usage_v1: {
        Args: { p_guild_code: string; p_season: string }
        Returns: {
          bombs_available: number
          bombs_used: number
          boss_tokens: number
          burned_tokens: number
          display_name: string
          max_possible: number
          player_mapping_id: number
          prime_tokens: number
          time_over_cap_seconds: number
          token_next_in_seconds: number
          tokens_available: number
          tokens_below_abuser: boolean
          tokens_below_offender: boolean
          tokens_used: number
        }[]
      }
      get_command_center_self_boss_performance_v1: {
        Args: {
          p_boss_name: string
          p_rarity: string
          p_season: string
          p_sets: number[]
        }
        Returns: {
          battle_count: number
          biggest_hit: number
          boss_name: string
          boss_preference: string
          encounter_id: number
          player_avg: number
          player_mapping_id: number
          player_vs_cluster_avg: number
          player_vs_guild_avg: number
          rarity: string
          set_num: number
          tier: number
        }[]
      }
      get_command_center_self_performance_summary_v1: {
        Args: { p_season: string }
        Returns: {
          avg_vs_cluster: number
          avg_vs_cluster_boss_only: number
          avg_vs_guild: number
          avg_vs_guild_boss_only: number
          boss_hits: number
          bosses_played: number
          player_mapping_id: number
          prime_hits: number
          primes_played: number
          total_battles: number
        }[]
      }
      get_command_center_self_roster_v1: {
        Args: { p_unit_ids: string[] }
        Returns: {
          active_ability_level: number
          category: string
          hero_display_name: string
          passive_ability_level: number
          player_mapping_id: number
          progression_index: number
          rank_name: string
          rarity: string
          stars: number
          synced_at: string
          unit_id: string
          web_icon_url: string
          xp_level: number
        }[]
      }
      get_command_center_self_team_usage_v1: {
        Args: { p_boss_name: string; p_rarity_set: string; p_season: string }
        Returns: {
          attack_count: number
          avg_damage: number
          boss_name: string
          boss_type: string
          encounter_index: number
          encounter_type: string
          meta_team: string
          player_mapping_id: number
          rarity: string
          rarity_set: string
          set_num: number
          team_composition: string
          team_hash: string
        }[]
      }
      get_command_center_self_token_usage_v1: {
        Args: { p_season: string }
        Returns: {
          bombs_available: number
          bombs_used: number
          boss_tokens: number
          burned_tokens: number
          max_possible: number
          player_mapping_id: number
          prime_tokens: number
          time_over_cap_seconds: number
          token_next_in_seconds: number
          tokens_available: number
          tokens_below_abuser: boolean
          tokens_below_offender: boolean
          tokens_used: number
        }[]
      }
      get_core_compositions: {
        Args: {
          p_guild_code: string
          p_limit?: number
          p_max_core_size?: number
          p_min_core_size?: number
          p_min_uses?: number
          p_season_count?: number
          p_side?: string
        }
        Returns: {
          core_heroes: Json
          core_id: string
          core_size: number
          flex_options: Json
          total_uses: number
          win_rate: number
          wins: number
        }[]
      }
      get_cron_secret: { Args: never; Returns: string }
      get_current_boss_status: {
        Args: { p_guild_code: string; p_season: string }
        Returns: {
          alive_primes: number
          boss_name: string
          completed_on: string
          encounter_id: number
          lifecycle_state: string
          loop_index: number
          max_hp: number
          rarity: string
          remaining_hp: number
          set: number
          warded: boolean
        }[]
      }
      get_current_season: { Args: never; Returns: string }
      get_current_war_status: {
        Args: { p_guild_code: string }
        Returns: {
          guild_score: number
          opponent_name: string
          opponent_score: number
          players_participated: number
          time_remaining: string
          total_tokens_used: number
          war_id: string
          war_phase: string
          war_status: string
        }[]
      }
      get_damage_by_boss_loop: {
        Args: { p_guild_code: string; p_season: string }
        Returns: {
          avg_damage: number
          boss_display_name: string
          end_time: string
          hit_count: number
          is_prime: boolean
          loop_index: number
          max_damage: number
          start_time: string
          total_damage: number
        }[]
      }
      get_discord_channel_mapping: {
        Args: { p_discord_channel_id: string; p_discord_guild_id: string }
        Returns: {
          cluster_code: string
          created_at: string
          default_for_notifications: boolean
          default_for_tokens: boolean
          game_guild_code: string
        }[]
      }
      get_discord_guild_mapping: {
        Args: { p_discord_guild_id: string }
        Returns: {
          cluster_code: string
          game_guild_code: string
          is_active: boolean
        }[]
      }
      get_discord_guild_mappings_all: {
        Args: { p_discord_guild_id: string }
        Returns: {
          cluster_code: string
          display_name: string
          game_guild_code: string
          is_active: boolean
          linked_at: string
        }[]
      }
      get_discord_role_mention: { Args: { role_id: string }; Returns: string }
      get_distinct_seasons: {
        Args: never
        Returns: {
          season: string
        }[]
      }
      get_distinct_seasons_for_guild: {
        Args: { p_cluster_code?: string; p_guild: string }
        Returns: string[]
      }
      get_duplicate_display_labels: {
        Args: { p_guild_code?: string }
        Returns: {
          display_name: string
          friendly_label: string
          original_display_name: string
          player_id: string
          previous_name: string
        }[]
      }
      get_effective_token_notification_preference: {
        Args: { p_channel: string; p_guild_code: string; p_player_id: string }
        Returns: {
          dedupe_window_seconds: number
          discord_channel_id: string
          enabled: boolean
          near_cap_threshold_seconds: number
          notify_on_capped: boolean
          notify_on_near_cap: boolean
          preference_id: string
        }[]
      }
      get_features_with_access: {
        Args: { p_user_id: string }
        Returns: {
          access_reason: string
          description: string
          display_name: string
          feature_key: string
          has_access: boolean
          icon: string
          release_stage: string
          route: string
          sort_order: number
          value_proposition: string
        }[]
      }
      get_five_season_averages: {
        Args: { p_current_season: number; p_guild_code: string }
        Returns: {
          avg_damage: number
          battle_count: number
          boss_name: string
          encounter_id: number
          rarity: string
          Season: string
          tier: number
        }[]
      }
      get_flexible_assignment_stats: {
        Args: { guild_code_param: string; season_param?: string }
        Returns: {
          avg_tokens_per_player: number
          boss_name: string
          max_tokens_per_boss: number
          players_assigned: number
          total_tokens_assigned: number
        }[]
      }
      get_flexible_token_coverage: {
        Args: { guild_code_param: string; season_param?: string }
        Returns: {
          boss_level: string
          boss_name: string
          coverage_percentage: number
          estimated_hp: number
          estimated_tokens_needed: number
          players_assigned: number
          tokens_assigned: number
        }[]
      }
      get_gear_level: { Args: { rank_name: string }; Returns: number }
      get_guild_api_key_coverage: {
        Args: { p_guild_code: string }
        Returns: {
          active_players: number
          coverage_percentage: number
          guild_api_status: string
          guild_code: string
          players_claimed: number
          players_with_api_key: number
          total_players: number
        }[]
      }
      get_guild_api_key_info: {
        Args: { p_guild_code: string }
        Returns: {
          api_key_is_valid: boolean
          api_key_last_validated: string
          api_owner: string
          guild_code: string
          has_api_key: boolean
        }[]
      }
      get_guild_avg_damage: {
        Args: { p_guild_code: string; p_season: string }
        Returns: number
      }
      get_guild_battle_counts: {
        Args: never
        Returns: {
          battle_count: number
          current_season_count: number
          guild_code: string
        }[]
      }
      get_guild_bombs_available: {
        Args: { p_guild_code: string }
        Returns: {
          bombs_available: number
          roster_size: number
        }[]
      }
      get_guild_boss_averages: {
        Args: { p_guild_code: string; p_season: string }
        Returns: {
          avg_damage: number
          boss_name: string
          encounter_id: number
          hit_count: number
          rarity: string
          set_num: number
        }[]
      }
      get_guild_boss_averages_batch: {
        Args: { p_guild_code: string; p_seasons: string[] }
        Returns: {
          avg_damage: number
          battle_count: number
          boss_key: string
          season: string
          total_damage: number
        }[]
      }
      get_guild_boss_avg_damage: {
        Args: {
          p_boss_name: string
          p_encounter_id: number
          p_guild_code: string
          p_rarity: string
          p_season: string
          p_set: number
        }
        Returns: number
      }
      get_guild_boss_leaderboard: {
        Args: { p_boss_name?: string; p_guild_code: string; p_season?: string }
        Returns: {
          avgDamage: number
          battleCount: number
          bombsUsed: number
          bossName: string
          categories: string[]
          displayName: string
          encounterIndex: number
          Guild: string
          heroDetails: Json
          machineOfWarDetails: Json
          maxDamage: number
        }[]
      }
      get_guild_boss_leaderboard_v2: {
        Args: { p_boss_name?: string; p_guild_code: string; p_season: string }
        Returns: {
          avg_damage: number
          battle_count: number
          boss_name: string
          current_rank: number
          displayname: string
          encounter_index: number
          guild: string
          total_damage: number
        }[]
      }
      get_guild_config_by_guild_id: {
        Args: { p_guild_id: string }
        Returns: {
          claimed_by_user: boolean
          cluster_code: string
          display_name: string
          enabled: boolean
          guild_code: string
          guild_id: string
          guild_tag: string
          has_api_key: boolean
          onboarding_completed: boolean
          onboarding_source: string
        }[]
      }
      get_guild_historical_performance: {
        Args: { p_guild_code: string; p_season_count?: number }
        Returns: {
          avg_damage_per_player: number
          season: string
          total_battles: number
          total_damage: number
          unique_players: number
          veteran_players: number
        }[]
      }
      get_guild_member_counts: {
        Args: never
        Returns: {
          guild_code: string
          leader_count: number
          member_count: number
          officer_count: number
        }[]
      }
      get_guild_member_stats: {
        Args: { p_guild_code: string; p_season?: string }
        Returns: {
          average_damage: number
          battle_count: number
          battles_last_7_days: number
          bomb_count: number
          config_guild_code: string
          display_name: string
          guild_code: string
          is_current: boolean
          last_active: string
          last_profile_update: string
          legendary_battles: number
          max_damage: number
          player_id: string
          primary_boss: string | null
          role: string
          secondary_boss: string | null
          theme_preference: string | null
          token_abuser_threshold: number
          token_offender_threshold: number
          token_status: string
          tokens_used: number
          total_damage: number
          unique_bosses_fought: number
        }[]
      }
      get_guild_members: {
        Args: { p_guild_code: string }
        Returns: {
          discord_user_id: string
          discord_username: string
          display_name: string
          guild_code: string
          is_current: boolean
          last_sync_at: string
          last_sync_bombs: number
          last_sync_tokens: number
          player_id: string
          role: string
          tacticus_username: string
          user_id: string
        }[]
      }
      get_guild_members_browser_safe: {
        Args: never
        Returns: {
          // OUT parameters do not carry nullability through gen-types.
          api_key_is_valid: boolean | null
          assignment_notes: string | null
          avatar_unit_id: string | null
          boss_preferences: Json | null
          display_name: string
          guild_code: string
          has_api_key: boolean | null
          is_claimed: boolean
          is_current: boolean
          last_battle_time: string | null
          last_bomb_time: string | null
          last_login_at: string | null
          last_sync_at: string | null
          last_sync_bombs: number | null
          last_sync_tokens: number | null
          officer_notes: string | null
          player_id: string
          player_level: number | null
          player_notes: string | null
          primary_boss: string | null
          primary_team: string | null
          role: string | null
          secondary_boss: string | null
          secondary_team: string | null
          tacticus_username: string
          tertiary_team: string | null
          timezone: string | null
          user_id: string | null
        }[]
      }
      get_guild_members_debug: {
        Args: { p_guild_code?: string }
        Returns: {
          claimed_status: string
          display_name: string
          guild_code: string
          is_current: boolean
          player_id: string
          role: string
          user_id: string
        }[]
      }
      get_guild_members_simple: {
        Args: never
        Returns: {
          api_key_encrypted: string
          api_key_is_valid: boolean
          assignment_notes: string
          avatar_unit_id: string
          boss_preferences: Json
          discord_user_id: string
          display_name: string
          guild_code: string
          is_current: boolean
          last_battle_time: string
          last_bomb_time: string
          last_login_at: string
          last_sync_at: string
          last_sync_bombs: number
          last_sync_tokens: number
          officer_notes: string
          player_id: string
          player_level: number
          player_notes: string
          primary_boss: string
          primary_team: string
          role: string
          secondary_boss: string
          secondary_team: string
          tacticus_api_key_encrypted: string
          tacticus_username: string
          tertiary_team: string
          timezone: string
          user_id: string
        }[]
      }
      get_guild_meta_analysis: {
        Args: { p_boss_name?: string; p_guild_code: string; p_season?: string }
        Returns: {
          avgdamage: number
          battlecount: number
          bossname: string
          categories: string[]
          consistency: number
          encounterindex: number
          maxdamage: number
          teamcomposition: Json
          winrate: number
        }[]
      }
      get_guild_overall_leaderboard: {
        Args: { p_guild_code: string; p_season?: string }
        Returns: {
          avgDamage: number
          battleCount: number
          bombsUsed: number
          bossesKilled: number
          currentRank: number
          displayName: string
          fiveSeasonAvgRank: number
          Guild: string
          percentVsCluster: number
          priorSeasonRank: number
          rankChange: number
          totalDamage: number
        }[]
      }
      get_guild_overall_leaderboard_v2: {
        Args: { p_guild_code: string; p_season: string }
        Returns: {
          avg_damage: number
          battle_count: number
          bombs_used: number
          bosses_killed: number
          current_rank: number
          displayname: string
          guild: string
          percent_vs_cluster: number
          total_damage: number
        }[]
      }
      get_guild_player_scores_batch: {
        Args: { p_guild_code: string; p_seasons: string[] }
        Returns: {
          battle_count: number
          season: string
          user_id: string
          weighted_vs_guild: number
        }[]
      }
      get_guild_rarities: {
        Args: { p_guild_code: string; p_season?: string }
        Returns: {
          battle_count: number
          rarity: string
        }[]
      }
      get_guild_season_forecast: {
        Args: {
          p_guild_code: string
          p_include_per_player?: boolean
          p_season_number?: number
        }
        Returns: Json
      }
      get_guild_season_summary: {
        Args: { p_guild_code: string; p_season: string }
        Returns: {
          avg_damage_per_hour: number
          boss_kills: number
          max_hit: number
          recent_activity: number
          total_battles: number
          total_damage: number
        }[]
      }
      get_guild_season_veterans: {
        Args: { p_guild_code: string; p_season_count?: number }
        Returns: {
          display_name: string
          seasons: string[]
        }[]
      }
      get_guild_team_roster: {
        Args: { p_guild_code: string; p_unit_ids: string[] }
        Returns: {
          active_ability_level: number
          category: string
          guild_role: string
          hero_display_name: string
          passive_ability_level: number
          player_display_name: string
          progression_index: number
          rank_name: string
          rarity: string
          stars: number
          synced_at: string
          unit_id: string
          web_icon_url: string
          xp_level: number
        }[]
      }
      get_guild_token_status: {
        Args: { p_guild_code: string; p_season?: string }
        Returns: {
          battles_today: number
          is_capped: boolean
          last_battle_time: string
          player_name: string
          tokens_available: number
        }[]
      }
      get_guild_trends_batch: {
        Args: { p_guild_code: string; p_seasons: string[] }
        Returns: {
          active_players: number
          avg_damage_per_token: number
          boss_kills: number
          guild_member_count: number
          guild_rank_in_cluster: number
          max_hit: number
          participation_rate: number
          reliability_score: number
          season: string
          total_battles: number
          total_damage: number
          total_guilds_in_cluster: number
          vs_cluster_percent: number
        }[]
      }
      get_guild_vs_cluster_boss_performance: {
        Args: { p_guild_code: string; p_rarities?: string[]; p_season: string }
        Returns: {
          boss_name: string
          cluster_avg_damage: number
          encounter_type: string
          guild_avg_damage: number
          rarity: string
          set: number
          vs_cluster_percent: number
        }[]
      }
      get_guild_vs_cluster_performance: {
        Args: { p_guild_code: string; p_season?: string }
        Returns: {
          boss_level: string
          boss_name: string
          cluster_avg_damage: number
          guild_damage: number
          performance_ratio: number
        }[]
      }
      get_guild_vs_cluster_prime_performance: {
        Args: { p_guild_code: string; p_season: string }
        Returns: {
          cluster_avg_damage: number
          guild_avg_damage: number
          prime_name: string
          rarity: string
          set: number
          vs_cluster_percent: number
        }[]
      }
      get_hero_performance: {
        Args: {
          p_guild_code: string
          p_limit?: number
          p_season_count?: number
          p_side: string
        }
        Returns: {
          avg_kills: number
          avg_score: number
          hero_key: string
          losses: number
          uses: number
          win_rate: number
          wins: number
        }[]
      }
      get_hero_stat: {
        Args: { base_stat: number; gear_level: number; stars?: number }
        Returns: number
      }
      get_homepage_statistics: {
        Args: never
        Returns: {
          active_clusters: number
          active_players: number
          battles_tracked: number
          guilds: number
          latest_season: string
          total_damage: number
          veteran_players: number
        }[]
      }
      get_hourly_activity: {
        Args: {
          p_boss_name?: string
          p_guild_code: string
          p_meta_team?: string
          p_player_names?: string[]
          p_rarities?: string[]
          p_roles?: string[]
          p_season?: string
        }
        Returns: {
          battle_count: number
          hour_of_day: number
          percentage: number
        }[]
      }
      get_invite_code_info: { Args: { p_code: string }; Returns: Json }
      get_latest_guild_snapshots: {
        Args: { p_cluster_code?: string; p_guild_code?: string }
        Returns: {
          active_players: number
          avg_damage_per_battle: number
          cluster_code: string
          cluster_name: string
          current_gr_ranking: number
          guild_code: string
          guild_name: string
          last_updated: string
          season: number
          top_boss_hits: Json
          total_battles: number
          total_damage: number
          veteran_count: number
          votlw_champions: Json
        }[]
      }
      get_guild_war_hero_usage: {
        Args: { p_guild_code: string }
        Returns: {
          is_mow: boolean
          player_id: string
          player_name: string
          times_died: number
          times_fielded: number
          unit_id: string
          war_id: string
        }[]
      }
      get_latest_season: { Args: never; Returns: string }
      get_latest_season_for_guild: {
        Args: { p_guild: string }
        Returns: string
      }
      get_leader_analytics_guilds: {
        Args: {
          p_access_level?: string
          p_cluster_code?: string
          p_guild_code?: string
        }
        Returns: {
          display_name: string
          enabled: boolean
          guild_code: string
          guild_tag: string
          token_abuser_threshold: number
          token_offender_threshold: number
        }[]
      }
      get_leader_analytics_player_mappings: {
        Args: {
          p_access_level?: string
          p_cluster_code?: string
          p_guild_code?: string
        }
        Returns: {
          display_name: string
          guild_code: string
          primary_boss: string
          secondary_boss: string
          user_id: string
        }[]
      }
      get_lineup_stats: {
        Args: {
          p_guild_code: string
          p_limit?: number
          p_season_count?: number
          p_side?: string
        }
        Returns: {
          avg_score: number
          lineup_id: string
          losses: number
          machine_of_war: Json
          units_json: Json
          uses: number
          win_rate: number
          wins: number
        }[]
      }
      get_meta_analysis_compositions: {
        Args: {
          p_cluster_code?: string
          p_encounter_id?: number
          p_guild_code?: string
          p_limit?: number
          p_min_battles?: number
          p_rarity: string
          p_season: string
          p_set: number
        }
        Returns: {
          avg_damage: number
          battles_count: number
          boss_name: string
          categories: string[]
          coef_variation: number
          composition_key: string
          encounter_id: number
          guild_count: number
          hero_unit_ids: string[]
          max_damage: number
          median_damage: number
          min_damage: number
          mow_unit_id: string
          player_count: number
          stability_rank: string
          stability_score: number
          standard_deviation: number
        }[]
      }
      get_meta_atlas_anonymous: {
        Args: {
          p_exclude_overkills?: boolean
          p_exclude_retreats?: boolean
          p_min_attacks?: number
          p_retreat_threshold?: number
          p_seasons?: string[]
        }
        Returns: {
          attack_count: number
          boss_type: string
          boss_unit_id: string
          damage_avg: number
          damage_max: number
          damage_p75: number
          damage_p90: number
          encounter_index: number
          encounter_type: string
          meta_team: string
          rarity: string
          rarity_set: string
          season: string
          set_num: number
          sub_boss_name: string
          team_composition: string
          team_hash: string
        }[]
      }
      get_meta_atlas_banded_by_player_power: {
        Args: {
          p_exclude_overkills?: boolean
          p_exclude_retreats?: boolean
          p_min_attacks_per_band?: number
          p_retreat_threshold?: number
          p_seasons?: string[]
        }
        Returns: {
          attack_count: number
          boss_type: string
          damage_avg: number
          damage_max: number
          damage_p75: number
          damage_p90: number
          encounter_type: string
          meta_team: string
          power_band: number
          power_band_ceil: number
          power_band_floor: number
          rarity: string
          season: string
          sub_boss_name: string
          team_composition: string
          team_hash: string
          tier: number
        }[]
      }
      get_meta_atlas_banded_by_team_power: {
        Args: {
          p_exclude_overkills?: boolean
          p_exclude_retreats?: boolean
          p_min_attacks_per_band?: number
          p_retreat_threshold?: number
          p_seasons?: string[]
        }
        Returns: {
          attack_count: number
          boss_type: string
          damage_avg: number
          damage_max: number
          damage_p50: number
          damage_p75: number
          damage_p90: number
          damage_p99: number
          encounter_type: string
          meta_team: string
          mow_power_ceil: number
          mow_power_floor: number
          power_band: number
          power_band_ceil: number
          power_band_floor: number
          rarity: string
          season: string
          sub_boss_name: string
          team_composition: string
          team_hash: string
          tier: number
        }[]
      }
      get_meta_atlas_coverage: {
        Args: { p_min_attacks?: number }
        Returns: {
          avg_attacks_per_combo: number
          boss_types_covered: number
          rarities_covered: number
          seasons_covered: number
          total_attacks: number
          total_team_boss_combos: number
        }[]
      }
      get_meta_atlas_distinct_bosses: {
        Args: never
        Returns: {
          boss_type: string
        }[]
      }
      get_meta_atlas_distinct_meta_teams: {
        Args: never
        Returns: {
          meta_team: string
        }[]
      }
      get_meta_atlas_distinct_rarity_sets: {
        Args: never
        Returns: {
          rarity_set: string
          sort_order: number
        }[]
      }
      get_meta_atlas_distinct_seasons: {
        Args: never
        Returns: {
          season: string
        }[]
      }
      get_meta_atlas_rarity_sets_by_season: {
        Args: never
        Returns: {
          rarity_set: string
          season: string
        }[]
      }
      get_meta_atlas_team_floor: {
        Args: {
          p_boss_type: string
          p_boss_unit_id?: string
          p_encounter_index?: number
          p_exclude_overkills?: boolean
          p_exclude_retreats?: boolean
          p_rarity_set?: string
          p_retreat_threshold?: number
          p_season?: string
          p_team_hash: string
        }
        Returns: {
          min_rank_index: number
          min_rank_name: string
          min_stars: number
          p90_damage: number
          sample_hits: number
          sample_players: number
          team_hash: string
          unit_id: string
        }[]
      }
      get_meta_team: { Args: { hero_details: string }; Returns: string }
      get_mow_power: { Args: { p_mow_details: string }; Returns: number }
      get_my_guild_membership: {
        Args: never
        Returns: {
          cluster_code: string
          cluster_set: boolean
          guild_code: string
          guild_display_name: string
          guild_enabled: boolean
          member_role: string
        }[]
      }
      get_my_onboarding_state: {
        Args: never
        Returns: {
          api_key_configured: boolean
          api_key_valid: boolean
          blocking_condition: string
          guild_resolved: boolean
          has_claimed_profile: boolean
        }[]
      }
      get_my_sync_status: {
        Args: never
        Returns: {
          api_key_configured: boolean
          api_key_last_verified: string
          api_key_valid: boolean
          guild_code: string
          guild_coverage_pct: number
          guild_has_recent_error: boolean
          guild_last_sync_at: string
          guild_sync_status: string
          last_sync_at: string
        }[]
      }
      get_mythic_boss_hp: {
        Args: never
        Returns: {
          boss_name: string
          max_hp: number
          set_level: number
        }[]
      }
      get_platform_summary_metrics: {
        Args: never
        Returns: {
          boss_battle_records: number
          clusters_with_guilds: number
          distinct_guilds_battle: number
          distinct_players_battle: number
          guild_war_battles: number
          player_mappings: number
          registered_users: number
        }[]
      }
      get_player_activity_summary: {
        Args: { p_days?: number; p_guild_code: string }
        Returns: {
          activity_types: string[]
          days_since_active: number
          last_activity_at: string
          last_activity_date: string
          player_name: string
          total_activities: number
        }[]
      }
      get_player_boss_avg_damage: {
        Args: { p_guild_code: string }
        Returns: {
          avg_damage: number
          battle_count: number
          boss_name: string
          boss_set: number
          display_name: string
        }[]
      }
      get_player_boss_performance:
        | {
            Args: { guild_code_param: string; season_param: string }
            Returns: {
              battle_count: number
              biggest_hit: number
              boss_name: string
              boss_preference: string
              display_name: string
              encounter_id: number
              player_avg: number
              player_vs_cluster_avg: number
              player_vs_guild_avg: number
              rarity: string
              set_num: number
              tier: number
            }[]
          }
        | {
            Args: {
              p_display_name: string
              p_guild_code: string
              p_rarities?: string[]
              p_season: string
            }
            Returns: {
              battle_count: number
              boss_name: string
              cluster_avg: number
              display_name: string
              encounter_id: number
              guild_avg: number
              player_avg: number
              rarity: string
              set: number
              tier: number
              token_usage_label: string
              user_id: string
              vs_cluster_pct: number
              vs_guild_pct: number
              weighted_contribution: number
            }[]
          }
        | {
            Args: {
              p_boss_name?: string
              p_guild_code: string
              p_player_name: string
              p_rarity?: string
              p_season: string
            }
            Returns: {
              battle_count: number
              boss_name: string
              cluster_avg: number
              encounter_id: number
              guild_avg: number
              player_avg: number
              player_id: string
              player_name: string
              rarity: string
              tier: number
              vs_cluster_pct: number
              vs_guild_pct: number
            }[]
          }
      get_player_boss_performance_cluster: {
        Args: {
          p_cluster_code?: string
          p_guild_code: string
          p_season: string
        }
        Returns: {
          avg_damage: number
          battles_fought: number
          boss_level: string
          guild_code: string
          max_damage: number
          min_damage: number
          player_name: string
          total_damage: number
        }[]
      }
      get_player_boss_performance_flexible: {
        Args: { guild_code_param: string; min_battles_param?: number }
        Returns: {
          avg_guild_damage: number
          avg_player_damage: number
          battle_count: number
          boss_name: string
          display_name: string
          has_sufficient_data: boolean
          player_vs_guild_avg: number
        }[]
      }
      get_player_boss_performance_historical: {
        Args: { guild_code_param: string }
        Returns: {
          avg_guild_damage: number
          avg_player_damage: number
          battle_count: number
          boss_name: string
          display_name: string
          player_vs_guild_avg: number
        }[]
      }
      get_player_boss_performance_historical_cluster: {
        Args: { p_cluster_code?: string; p_guild_code: string }
        Returns: {
          avg_damage: number
          battles_fought: number
          boss_level: string
          boss_name: string
          max_damage: number
          min_damage: number
          player_name: string
          season: string
          total_damage: number
        }[]
      }
      get_player_boss_rankings: {
        Args: {
          p_cluster_code: string
          p_guild_code: string
          p_player_name: string
          p_season: string
        }
        Returns: {
          boss_name: string
          encounter_id: number
          player_rank: number
          total_players: number
        }[]
      }
      get_player_context: {
        Args: { p_player_name: string; p_season: string }
        Returns: {
          cluster_code: string
          guild_code: string
          player_name: string
        }[]
      }
      get_player_damage_by_boss_loop: {
        Args: { p_display_name: string; p_guild_code: string; p_season: string }
        Returns: {
          avg_damage: number
          boss_display_name: string
          crash_count: number
          eff_avg_damage: number
          end_time: string
          hit_count: number
          is_prime: boolean
          loop_index: number
          max_damage: number
          one_shot_count: number
          start_time: string
          sweep_count: number
          total_damage: number
        }[]
      }
      get_player_damage_by_loop_for_boss: {
        Args: {
          p_boss_name: string
          p_guild_code: string
          p_level: string
          p_season: string
        }
        Returns: {
          avg_damage: number
          display_name: string
          hit_count: number
          loop_index: number
          max_damage: number
          total_damage: number
        }[]
      }
      get_player_five_season_averages: {
        Args: {
          p_current_season: number
          p_guild_code: string
          p_tier_max?: number
          p_tier_min?: number
        }
        Returns: {
          avg_damage: number
          battle_count: number
          boss_name: string
          encounter_id: number
          is_current_member: boolean
          player_id: string
          player_name: string
          rarity: string
          Season: string
          tier: number
          vs_cluster_pct: number
          vs_guild_pct: number
        }[]
      }
      get_player_historical_performance: {
        Args: {
          p_cluster_code?: string
          p_guild_code: string
          p_player_name: string
        }
        Returns: {
          cluster_rank: number
          season: string
          vs_cluster_pct: number
          vs_guild_pct: number
        }[]
      }
      get_player_mapping_debug: {
        Args: { p_user_id: string }
        Returns: {
          discord_username: string
          display_name: string
          guild_code: string
          is_current: boolean
          joined_at: string
          officer_notes: string
          player_id: string
          rls_check: string
          role: string
          tacticus_share_url: string
          theme_preference: string
          timezone: string
          updated_at: string
          user_id: string
          username: string
        }[]
      }
      get_player_meta_team_engagement: {
        Args: {
          p_guild_code: string
          p_min_season: number
          p_min_tokens?: number
          p_player_ids: string[]
        }
        Returns: {
          meta_team: string
          player_id: string
          token_count: number
        }[]
      }
      get_player_performance: {
        Args: { p_player: string; p_season?: string }
        Returns: {
          avg_damage: number
          damage_types_used: string[]
          displayName: string
          Guild: string
          hit_count: number
          max_damage: number
          max_loop: number
          min_loop: number
          Season: string
          total_damage: number
          unique_bosses_hit: number
        }[]
      }
      get_player_performance_in_cluster: {
        Args: {
          p_cluster_code: string
          p_guild_code: string
          p_season: string
          p_user_id: string
        }
        Returns: {
          battle_count: number
          cluster_rank: number
          guild_code: string
          guild_rank: number
          player_name: string
          total_damage: number
          total_players_in_cluster: number
          total_players_in_guild: number
          vs_cluster_pct: number
          vs_guild_pct: number
        }[]
      }
      get_player_performance_in_cluster_v2: {
        Args: {
          p_cluster_code: string
          p_guild_code: string
          p_player_name: string
          p_season: string
        }
        Returns: {
          cluster_avg: number
          cluster_rank: number
          guild_avg: number
          player_avg: number
          vs_cluster_pct: number
          vs_guild_pct: number
        }[]
      }
      get_player_performance_ranks_for_players: {
        Args: { p_player_ids: string[]; p_season: string }
        Returns: {
          avg_damage: number
          battle_count: number
          cluster_code: string
          cluster_rank: number
          Guild: string
          guild_rank: number
          max_damage: number
          performance_tier: string
          player_id: string
          player_name: string
          Season: string
          total_damage: number
          unique_bosses: number
        }[]
      }
      get_player_performance_summary: {
        Args: { p_guild_code: string; p_rarities?: string[]; p_season: string }
        Returns: {
          avg_vs_cluster: number
          avg_vs_cluster_boss_only: number
          avg_vs_guild: number
          avg_vs_guild_boss_only: number
          boss_hits: number
          bosses_played: number
          display_name: string
          prime_hits: number
          primes_played: number
          total_battles: number
          user_id: string
        }[]
      }
      get_player_performance_vs_cluster: {
        Args: { p_guild: string; p_season: string }
        Returns: {
          battle_count: number
          boss_name: string
          cluster_avg_damage: number
          display_name: string
          encounter_type: string
          guild_avg_damage: number
          player_avg_damage: number
          vs_cluster_percent: number
          vs_guild_percent: number
        }[]
      }
      get_player_prime_performance: {
        Args: { guild_code_param: string; season_param: string }
        Returns: {
          battle_count: number
          biggest_hit: number
          boss_preference: string
          display_name: string
          encounter_id: number
          player_avg: number
          player_vs_cluster_avg: number
          player_vs_guild_avg: number
          prime_name: string
          rarity: string
          set_num: number
          tier: number
        }[]
      }
      get_player_rankings: {
        Args: {
          p_guild_code: string
          p_limit?: number
          p_season?: number
          p_sort_by?: string
        }
        Returns: {
          avg_tokens: number
          player_id: string
          player_name: string
          rank: number
          total_attempts: number
          total_damage: number
          win_rate: number
          wins: number
        }[]
      }
      get_player_stats_comprehensive: {
        Args: { p_display_name: string; p_guild_code: string; p_season: string }
        Returns: Json
      }
      get_player_team_compositions: {
        Args: { p_guild_code: string; p_season_limit?: number }
        Returns: {
          boss_name: string
          player_name: string
          team_compositions: Json
          usage_count: number
        }[]
      }
      get_player_team_compositions_simple: {
        Args: { p_guild_code: string; p_season_limit?: number }
        Returns: {
          boss_name: string
          player_name: string
          team_compositions: string
          usage_count: number
        }[]
      }
      get_player_team_usage: {
        Args: { p_guild_code: string; p_player_name: string; p_season?: string }
        Returns: {
          attack_count: number
          avg_damage: number
          boss_name: string
          boss_type: string
          encounter_index: number
          encounter_type: string
          meta_team: string
          rarity: string
          rarity_set: string
          set_num: number
          team_composition: string
          team_hash: string
        }[]
      }
      get_player_token_burn_history: {
        Args: {
          p_display_name?: string
          p_guild_code: string
          p_limit?: number
          p_player_id?: string
        }
        Returns: {
          burned_tokens: number
          display_name: string
          player_id: string
          season: string
          season_end_at: string
          season_start_at: string
          time_over_cap_seconds: number
          updated_at: string
        }[]
      }
      get_player_token_state: {
        Args: {
          p_cluster_code?: string
          p_guild_code: string
          p_player_id?: string
          p_season?: string
        }
        Returns: {
          bomb_next_in_seconds: number
          bombs_available: number
          burned_tokens: number
          data_source: string
          discord_user_id: string
          display_name: string
          is_capped: boolean
          last_battle_time: string
          last_sync_at: string
          max_possible: number
          player_id: string
          post_snapshot_spends: number
          time_over_cap_seconds: number
          time_to_next_token: string
          token_next_in_seconds: number
          tokens_available: number
          tokens_used: number
        }[]
      }
      get_player_token_summary: {
        Args: { guild_code_param: string; season_param?: string }
        Returns: {
          bosses_assigned: number
          display_name: string
          max_tokens_allowed: number
          token_allocations: Json
          total_tokens_used: number
        }[]
      }
      get_prime_boss_hp: {
        Args: never
        Returns: {
          boss_name: string
          encounter_id: number
          max_hp: number
          set_level: number
        }[]
      }
      get_public_global_leaderboard: {
        Args: { p_limit?: number }
        Returns: {
          avg_damage: number
          battle_count: number
          cluster_display_name: string
          display_name: string
          guild_display_name: string
          is_obfuscated: boolean
          max_damage: number
          performance_score: number
          rank: number
          total_damage: number
        }[]
      }
      get_public_stats: { Args: never; Returns: Json }
      get_public_stats_cached: {
        Args: never
        Returns: {
          active_players: number
          battles_tracked: number
          cached_at: string
          guilds: number
          total_damage: number
        }[]
      }
      get_public_stats_live: { Args: never; Returns: Json }
      get_public_stats_v2: {
        Args: never
        Returns: {
          active_players: number
          battles_tracked: number
          guilds: number
          total_damage: number
        }[]
      }
      get_queue_stats: {
        Args: never
        Returns: {
          avg_wait_time_seconds: number
          count: number
          oldest_pending: string
          status: string
        }[]
      }
      get_rank_name: { Args: { gear_level: number }; Returns: string }
      get_rarity_set: {
        Args: { p_rarity: string; p_set: number }
        Returns: string
      }
      get_recommended_teams_for_season: {
        Args: {
          p_cluster_code?: string
          p_guild_filter?: string
          p_season: string
        }
        Returns: {
          avg_damage: number
          category: string
          level_string: string
          rarity: string
          set: number
          success_rate: number
          team_composition: string[]
          usage_count: number
        }[]
      }
      get_scoped_player_profile: {
        Args: { p_user_id: string }
        Returns: {
          cluster_code: string | null
          display_name: string | null
          guild_code: string | null
          is_current: boolean | null
          last_sync_at: string | null
          role: Database["public"]["Enums"]["app_role"] | null
        }[]
      }
      get_season_token_stats: {
        Args: {
          p_guild_code: string
          p_include_cluster?: boolean
          p_season: number
        }
        Returns: {
          cluster_code: string
          context: string
          guild_code: string
          players: Json
          ratio_spent: number
          season: number
          tokens_per_player_cap: number
          tokens_possible: number
          tokens_remaining: number
          tokens_spent: number
          updated_at: string
        }[]
      }
      get_season_token_stats_batch: {
        Args: { p_guild_code: string; p_seasons: string[] }
        Returns: {
          display_name: string
          season: string
          tokens_possible: number
          tokens_spent: number
          user_id: string
        }[]
      }
      get_seasonal_meta_atlas_top_teams: {
        Args: {
          p_boss_types: string[]
          p_main_min_attacks?: number
          p_prime_min_attacks?: number
          p_rarity_sets: string[]
        }
        Returns: {
          attack_count: number
          boss_type: string
          damage_avg: number
          damage_p75: number
          damage_p90: number
          encounter_index: number
          meta_team: string
          rarity_set: string
          season: string
          team_composition: string
          team_hash: string
        }[]
      }
      get_seasons_for_guild: {
        Args: { p_guild: string }
        Returns: {
          record_count: number
          season: string
        }[]
      }
      get_service_role_key: { Args: never; Returns: string }
      get_stage_kill_duration_medians: {
        Args: {
          p_current_season: number
          p_guild_code: string
          p_window_days?: number
        }
        Returns: {
          loop_index: number
          median_seconds: number
          sample_count: number
          source: string
          stage_code: string
        }[]
      }
      get_stale_players: {
        Args: { p_guild_code: string; p_inactivity_days?: number }
        Returns: {
          days_inactive: number
          last_activity_at: string
          last_activity_date: string
          player_name: string
          wars_since_active: number
        }[]
      }
      get_sub_boss_name: {
        Args: { p_boss_type: string; p_encounter_idx: number }
        Returns: string
      }
      get_table_columns: {
        Args: { table_name: string }
        Returns: {
          column_name: string
          data_type: string
        }[]
      }
      get_tacticus_api_key: { Args: never; Returns: string }
      get_team_display: {
        Args: { hero_details: string; mow_details: string }
        Returns: string
      }
      get_team_hero_power: { Args: { p_hero_details: string }; Returns: number }
      get_token_allocation_settings: {
        Args: { p_guild_code: string }
        Returns: {
          primary_tokens: number
          secondary_tokens: number
        }[]
      }
      get_token_burn_state: {
        Args: {
          p_display_name: string
          p_guild_code: string
          p_player_id: string
          p_season: string
        }
        Returns: {
          burned_tokens: number
          display_name: string
          last_over_cap_started_at: string
          player_id: string
          time_over_cap_seconds: number
          updated_at: string
        }[]
      }
      get_token_usage_by_loop: {
        Args: { p_guild_code: string; p_rarities?: string[]; p_season: string }
        Returns: {
          bosses: number
          loop_index: number
          primes: number
          rarities: string[]
        }[]
      }
      get_token_usage_by_loop_and_set: {
        Args: { p_guild_code: string; p_rarities?: string[]; p_season: string }
        Returns: {
          loop_index: number
          set_key: string
          token_count: number
        }[]
      }
      get_token_usage_for_guild: {
        Args: { p_guild_code: string; p_season: string }
        Returns: {
          bombs_available: number
          bombs_used: number
          boss_tokens: number
          burned_tokens: number
          display_name: string
          max_possible: number
          player_id: string
          prime_tokens: number
          time_over_cap_seconds: number
          token_next_in_seconds: number
          tokens_available: number
          tokens_below_abuser: boolean
          tokens_below_offender: boolean
          tokens_used: number
        }[]
      }
      get_unmapped_players: {
        Args: { p_guild_code: string }
        Returns: {
          display_name: string
          player_id: string
        }[]
      }
      get_user_access_levels: { Args: { p_user_id: string }; Returns: Json }
      get_user_accessible_guilds: {
        Args: never
        Returns: {
          guild_code: string
        }[]
      }
      get_user_auth_context: { Args: { p_user_id: string }; Returns: Json }
      get_user_cluster_code: { Args: { p_user_id?: string }; Returns: string }
      get_user_cluster_context: {
        Args: { p_user_id: string }
        Returns: {
          cluster_code: string
          cluster_id: string
          cluster_name: string
          guild_code: string
          is_leader: boolean
          is_officer: boolean
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      get_user_data_for_export: { Args: { p_user_id: string }; Returns: Json }
      get_user_guild_code: { Args: { p_user_id?: string }; Returns: string }
      get_user_profile: {
        Args: { p_user_id: string }
        Returns: {
          discord_username: string
          display_name: string
          guild_code: string
          is_current: boolean
          joined_at: string
          officer_notes: string
          player_id: string
          role: string
          tacticus_share_url: string
          theme_preference: string
          timezone: string
          updated_at: string
          user_id: string
          username: string
        }[]
      }
      get_user_support_unread_count: {
        Args: { p_user_id: string }
        Returns: number
      }
      get_users_needing_guild_update: {
        Args: never
        Returns: {
          current_guild_code: string
          display_name: string
          is_current: boolean
          last_battle_guild: string
          needs_update: boolean
          player_id: string
          user_id: string
        }[]
      }
      get_veteran_counts_by_guild: {
        Args: { p_guild_codes: string[]; p_season_count?: number }
        Returns: {
          guild_code: string
          veteran_count: number
        }[]
      }
      get_veteran_players_stats: {
        Args: { p_guild_code: string }
        Returns: {
          avg_damage_per_season: number
          first_season: string
          latest_season: string
          player_id: string
          player_name: string
          seasons_played: number
          total_battles: number
          total_damage: number
        }[]
      }
      get_votlw_most_improved_player: {
        Args: {
          p_cluster_code?: string
          p_guild_code: string
          p_season: string
        }
        Returns: Json
      }
      get_votlw_season_awards_data: {
        Args: {
          p_cluster_code?: string
          p_guild_code: string
          p_season: string
        }
        Returns: Json
      }
      get_votlw_set_winners: {
        Args: {
          p_cluster_code?: string
          p_guild_code: string
          p_season: string
        }
        Returns: Json
      }
      get_war_analytics: {
        Args: { p_guild_code: string; p_season?: number }
        Returns: {
          cumulative_win_rate: number
          guild_score: number
          opponent_score: number
          participation_rate: number
          result: string
          total_attempts: number
          total_damage: number
          war_date: string
          war_id: string
        }[]
      }
      get_war_battle_history: {
        Args: { p_guild_code: string; p_guild_war_id?: string }
        Returns: {
          attacker_display_name: string
          attacker_power: number
          attacker_units: Json
          battle_id: string
          battle_time: string
          defender_display_name: string
          defender_power: number
          defender_units: Json
          guild_war_id: string
          is_guild_attack: boolean
          score: number
          zone_type: string
        }[]
      }
      get_war_room_team_readiness: {
        Args: { p_guild_code: string; p_min_rank_index?: number }
        Returns: {
          floor_rank_index: number
          floor_rank_name: string
          heroes: Json
          missing_units: Json
          ready: boolean
          team_id: string
          team_name: string
          team_priority: number
          team_side: string
          weakest_unit_id: string
        }[]
      }
      get_war_participation_summary:
        | {
            Args: { p_guild_code: string; p_guild_war_id: string }
            Returns: {
              attempts_remaining: number
              attempts_used: number
              display_name: string
              last_activity_on: string
              opted_in: boolean
              player_id: string
              score: number
            }[]
          }
        | {
            Args: { p_guild_code: string; p_season?: number; p_war_id?: string }
            Returns: {
              attempts: number
              damage_dealt: number
              max_tokens: number
              participation_rate: number
              player_id: string
              player_name: string
              tokens_used: number
              wins: number
            }[]
          }
      get_war_player_stats: {
        Args: { p_guild_code: string; p_war_id: string }
        Returns: {
          avg_score: number
          breached: number
          conceded: number
          defended: number
          failed_hits: number
          held: number
          hold_rate: number
          is_guild_member: boolean
          losses: number
          perfect_hits: number
          player_id: string
          player_name: string
          points: number
          total_attacks: number
          win_rate: number
          wins: number
        }[]
      }
      get_war_stats: {
        Args: { p_guild_code: string; p_war_id: string }
        Returns: {
          avg_score: number
          failed_hits: number
          hold_rate: number
          our_attacks: number
          our_points: number
          our_wins: number
          perfect_hits: number
          their_attacks: number
          their_points: number
          their_wins: number
          win_rate: number
        }[]
      }
      get_webhook_url: {
        Args: {
          p_cluster_code?: string
          p_guild_code?: string
          p_webhook_type: string
        }
        Returns: string
      }
      get_write_queue_stats: {
        Args: never
        Returns: {
          by_circuit: Json
          count: number
          oldest_pending: string
          status: string
        }[]
      }
      get_write_statistics: {
        Args: never
        Returns: {
          deletes: number
          inserts: number
          table_name: string
          table_size: string
          updates: number
          write_percentage: number
          writes_total: number
        }[]
      }
      get_zone_performance: {
        Args: { p_guild_code: string; p_season?: number }
        Returns: {
          avg_damage: number
          losses: number
          total_attempts: number
          win_rate: number
          wins: number
          zone_id: string
          zone_name: string
        }[]
      }
      get_zone_stats: {
        Args: {
          p_days_back?: number
          p_guild_code: string
          p_season_count?: number
        }
        Returns: {
          defense_attacks: number
          defense_avg_conceded: number
          defense_hold_rate: number
          defense_holds: number
          map_code: string
          offense_attacks: number
          offense_avg_score: number
          offense_win_rate: number
          offense_wins: number
          zone_display_name: string
          zone_type: string
        }[]
      }
      guild_restricts_playbook_access: {
        Args: { p_user_id?: string }
        Returns: boolean
      }
      guild_roster_write_health: {
        Args: {
          p_min_current_rows?: number
          p_min_fresh_fraction?: number
          p_stale_days?: number
        }
        Returns: {
          current_rows: number
          fresh_fraction: number | null
          guild_code: string
          last_roster_write_at: string | null
          max_updated_at: string | null
          roster_write_age_hours: number | null
          roster_write_failures: number
          rows_written_in_window: number
          sync_looks_healthy: boolean
          verdict: string
        }[]
      }
      handle_guild_sync_request: {
        Args: { p_guild_code: string; p_user_id?: string }
        Returns: Json
      }
      has_active_guilds: { Args: { p_cluster_id: string }; Returns: boolean }
      has_active_users: { Args: { p_guild_code: string }; Returns: boolean }
      has_current_guild_membership: {
        Args: { target_guild_code: string; target_user_id?: string }
        Returns: boolean
      }
      hash_password: { Args: { password: string }; Returns: string }
      is_cluster_member: { Args: { p_cluster_code: string }; Returns: boolean }
      is_current_user_app_admin: { Args: never; Returns: boolean }
      is_possession_proof_code: { Args: { p_code: string }; Returns: boolean }
      is_user_assigned_to_boss: {
        Args: { p_boss_id: string; p_user_id?: string }
        Returns: boolean
      }
      is_user_officer_or_leader: {
        Args: { p_user_id?: string }
        Returns: boolean
      }
      list_active_player_invite_codes: {
        Args: { p_guild_code: string }
        Returns: {
          code: string
          expires_at: string
          player_id: string
        }[]
      }
      list_player_invite_codes: {
        Args: { p_guild_code?: string }
        Returns: {
          code: string
          created_at: string
          display_name: string
          expires_at: string
          guild_code: string
          id: string
          player_id: string
          revoked_at: string
          used_at: string
        }[]
      }
      log_edge_function_execution: {
        Args: {
          p_cluster_code: string
          p_details?: Json
          p_function_name: string
          p_status: string
        }
        Returns: undefined
      }
      manage_season_assignments: {
        Args: {
          p_assignments?: Json
          p_bosses?: Json
          p_guild_code: string
          p_mode?: string
          p_primary_secondary?: Json
          p_season_number: string
        }
        Returns: Json
      }
      manual_refresh_guild_snapshots: { Args: never; Returns: Json }
      mark_support_messages_read: {
        Args: { p_is_admin?: boolean; p_ticket_id: string; p_user_id: string }
        Returns: number
      }
      matview_refresh_health: {
        Args: never
        Returns: {
          detail: string
          is_unhealthy: boolean
          signal: string
        }[]
      }
      merge_duplicate_player_mappings: {
        Args: never
        Returns: {
          kept_guild_code: string
          player_id: string
          preserved_user_id: string
          records_merged: number
          removed_guild_codes: string[]
        }[]
      }
      merge_season_boss_sub_bosses: {
        Args: {
          p_guild_code: string
          p_level: string
          p_patch: Json
          p_season_number: string
          p_selected_by: string
        }
        Returns: {
          boss_name: string
          guild_code: string
          id: string
          level: string
          season_number: string
          selected_at: string | null
          selected_by: string | null
          sub_bosses: Json | null
        }
        SetofOptions: {
          from: "*"
          to: "upcoming_season_bosses"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      migrate_boss_target_tokens_legacy_names: {
        Args: { p_apply?: boolean }
        Returns: {
          action: string
          encounter_id: number
          guild_code: string
          legacy_boss_name: string
          phase: string
          rarity: string
          resolved_boss_type: string
          set_num: number
          target_tokens: number
        }[]
      }
      migrate_player_api_key: {
        Args: { p_encrypted_key: string; p_player_id: string }
        Returns: undefined
      }
      migrate_to_v2_functions: { Args: never; Returns: string }
      claim_bootstrap_seat: { Args: { p_code: string }; Returns: Json }
      claim_consume_read_invite: {
        Args: { p_code: string }
        Returns: {
          id: string
          code: string
          player_id: string
          guild_code: string
          display_name: string
          expires_at: string
          used_at: string
          revoked_at: string
        }[]
      }
      mint_bootstrap_seat_invite: {
        Args: {
          p_player_id: string
          p_subject: string
          p_upstream_digest: string
        }
        Returns: string
      }
      mint_registrar_seat_invite: {
        Args: {
          p_player_id: string
          p_subject: string
          p_upstream_digest: string
        }
        Returns: string
      }
      record_guild_bootstrap_claim_authority: {
        Args: {
          p_attempt_generation: number
          p_guild_code: string
          p_source?: string
          p_subject: string
        }
        Returns: undefined
      }
      mint_player_possession_invite: {
        Args: {
          p_player_id: string
          p_subject: string
          p_upstream_digest: string
        }
        Returns: string
      }
      postgrest_anon_probe: {
        Args: never
        Returns: {
          ok: boolean
        }[]
      }
      prepare_discord_identity_unlink: { Args: never; Returns: Json }
      process_cap_notifications: {
        Args: { p_guild_code?: string }
        Returns: {
          capped_players: Json
          guild_code: string
          notification_count: number
        }[]
      }
      process_raw_api_to_structured: { Args: never; Returns: undefined }
      project_token_snapshot: {
        Args: {
          p_cap: number
          p_count: number
          p_next_seconds: number
          p_now: string
          p_regen_secs: number
          p_snapshot_at: string
          p_spends: string[]
        }
        Returns: {
          available: number
          next_in_seconds: number
        }[]
      }
      qualifying_sweep_count: {
        Args: { sweep_damages: number[]; threshold: number }
        Returns: number
      }
      qualifying_sweep_sum: {
        Args: { sweep_damages: number[]; threshold: number }
        Returns: number
      }
      queue_proactive_token_notifications: {
        Args: { p_guild_code?: string; p_now?: string; p_season?: string }
        Returns: {
          guild_code: string
          queued_discord: number
          queued_in_app: number
          queued_total: number
          season: string
        }[]
      }
      queue_token_burn_notifications: {
        Args: { p_guild_code?: string; p_now?: string; p_season?: string }
        Returns: {
          guild_code: string
          queued_discord: number
          queued_in_app: number
          queued_total: number
          season: string
        }[]
      }
      reap_stuck_work_jobs: {
        Args: { p_timeout_seconds?: number }
        Returns: number
      }
      recalculate_sync_tiers: {
        Args: never
        Returns: {
          guild_code: string
          new_tier: string
          old_tier: string
        }[]
      }
      recommend_boss_teams: {
        Args: { p_boss_types: string[]; p_future_season: string }
        Returns: {
          avg_damage: number
          best_season: string
          boss_name: string
          boss_type: string
          original_guild: string
          performance_score: number
          player_name: string
          recommendation_strength: string
          seasons_engaged: number
          total_tokens_used: number
        }[]
      }
      reconcile_own_guild_membership:
        | {
            Args: {
              p_player_id: string
              p_source_guild: string
              p_source_guild_id: string
              p_subject: string
              p_target_guild: string
              p_target_guild_id: string
              p_target_role: string
              p_upstream_digest: string
            }
            Returns: Json
          }
        | {
            Args: {
              p_attempt_generation: number
              p_player_id: string
              p_source_guild: string
              p_source_guild_id: string
              p_subject: string
              p_target_guild: string
              p_target_guild_id: string
              p_target_role: string
              p_upstream_digest: string
            }
            Returns: Json
          }
      reconcile_own_guild_membership_legacy_impl: {
        Args: {
          p_player_id: string
          p_source_guild: string
          p_source_guild_id: string
          p_subject: string
          p_target_guild: string
          p_target_guild_id: string
          p_target_role: string
          p_upstream_digest: string
        }
        Returns: Json
      }
      record_roster_write_outcome: {
        Args: {
          p_guild_code: string
          p_ok: boolean
          p_reason?: string | null
          p_rows_written?: number | null
        }
        Returns: undefined
      }
      record_token_burn_state: {
        Args: {
          p_display_name: string
          p_guild_code: string
          p_now?: string
          p_player_id: string
          p_season: string
          p_token_next_in_seconds: number
          p_tokens_available: number
        }
        Returns: {
          burned_tokens: number
          created_at: string
          display_name: string | null
          guild_code: string
          id: number
          last_over_cap_started_at: string | null
          last_seen_token_next_seconds: number | null
          last_seen_tokens: number | null
          player_id: string | null
          season: string
          time_over_cap_seconds: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "token_burn_state"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      refresh_all_materialized_views: { Args: never; Returns: string }
      refresh_cluster_averages: { Args: never; Returns: undefined }
      refresh_cluster_rankings: { Args: never; Returns: undefined }
      refresh_critical_views: { Args: never; Returns: string }
      refresh_guild_snapshots: {
        Args: { p_season?: number }
        Returns: undefined
      }
      refresh_materialized_views: { Args: never; Returns: undefined }
      refresh_member_stats_summary: { Args: never; Returns: undefined }
      refresh_meta_atlas_all: {
        Args: never
        Returns: {
          rows_inserted: number
          season: string
        }[]
      }
      refresh_meta_atlas_season: {
        Args: { p_season: string }
        Returns: {
          rows_affected: number
        }[]
      }
      refresh_meta_atlas_seasons: {
        Args: { p_seasons: string[] }
        Returns: {
          rows_inserted: number
          season: string
        }[]
      }
      refresh_player_materialized_views: { Args: never; Returns: string }
      refresh_public_guild_snapshots: { Args: never; Returns: undefined }
      refresh_public_stats: { Args: never; Returns: undefined }
      refresh_votlw_winners: { Args: never; Returns: Json }
      register_user: {
        Args: { email: string; password: string; username: string }
        Returns: undefined
      }
      remove_player_api_key_admin: {
        Args: { p_player_id: string }
        Returns: Json
      }
      repair_unmapped_player: {
        Args: { p_guild: string; p_new_display_name: string; p_user_id: string }
        Returns: number
      }
      reset_stuck_jobs: {
        Args: { p_timeout_minutes?: number }
        Returns: number
      }
      resolve_boss_name: { Args: { p_name: string }; Returns: string }
      resolve_discord_guild_context: {
        Args: {
          p_discord_channel_id?: string
          p_discord_guild_id: string
          p_discord_user_id?: string
          p_requested_guild?: string
          p_scope?: string
        }
        Returns: {
          all_guilds: Json
          cluster_code: string
          display_name: string
          guild_code: string
          source: string
        }[]
      }
      resolve_season_boss_name: {
        Args: {
          p_boss_position: number
          p_encounter_id: number
          p_fallback_name: string
          p_season: number
        }
        Returns: string
      }
      resolve_verified_discord_identities: {
        Args: { p_discord_user_ids: string[] }
        Returns: {
          discord_user_id: string
          guild_code: string
          is_app_admin: boolean
          mapping_id: number
          ownership_attestation_id: string
          player_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      resolve_verified_players: {
        Args: { p_user_ids: string[] }
        Returns: {
          guild_code: string
          is_app_admin: boolean
          mapping_id: number
          ownership_attestation_id: string
          player_id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }[]
      }
      revoke_all_player_identity_for_subject: {
        Args: {
          p_actor_user_id: string
          p_reason: string
          p_source: string
          p_user_id: string
        }
        Returns: number
      }
      revoke_player_invite_code: {
        Args: { p_invite_id: string; p_reason: string }
        Returns: Json
      }
      revoke_player_mapping_ownership: {
        Args: { p_mapping_id: number; p_reason: string }
        Returns: Json
      }
      schedule_tacticus_data_import: {
        Args: { schedule_interval?: string }
        Returns: undefined
      }
      search_players_simple: {
        Args: { search_text?: string }
        Returns: {
          display_name: string
          guild_code: string
          player_id: string
        }[]
      }
      settle_own_guild_onboarding_attempt: {
        Args: {
          p_error_message?: string
          p_generation: number
          p_guild_code?: string
          p_guild_mode?: string
          p_guild_name?: string
          p_outcome: string
          p_role_intent?: string
          p_subject: string
          p_sync_status?: string
        }
        Returns: Json
      }
      set_active_progression_config: {
        Args: { p_id: string; p_is_active: boolean }
        Returns: undefined
      }
      set_player_app_admin_bulk: {
        Args: { p_is_app_admin: boolean; p_user_ids: string[] }
        Returns: {
          user_id: string
        }[]
      }
      set_tacticus_api_key: { Args: { api_key: string }; Returns: undefined }
      suggest_player_mapping_fixes: {
        Args: never
        Returns: {
          issue_type: string
          player_identifier: string
          priority: string
          suggested_action: string
        }[]
      }
      tacticus_rank_index: {
        Args: { p_rank_name: string }
        Returns: number
      }
      tacticus_rank_name: {
        Args: { p_rank_index: number }
        Returns: string
      }
      test_boss_rankings_simple: {
        Args: { p_player_name: string; p_season: string }
        Returns: {
          boss_name: string
          player_damage: number
          player_rank: number
          total_players: number
        }[]
      }
      test_performance_calculations: {
        Args: { p_guild_code: string; p_season: string }
        Returns: {
          actual_result: number
          difference_pct: number
          expected_result: number
          status: string
          test_name: string
        }[]
      }
      test_player_search: {
        Args: { p_search_term: string }
        Returns: {
          current_name: string
          guild_count: number
          historical_names: string[]
          player_id: string
          season_count: number
          total_battles: number
        }[]
      }
      toggle_webhook_cron_job: {
        Args: { p_enabled: boolean; p_job_name: string }
        Returns: undefined
      }
      trigger_historical_backfill: { Args: never; Returns: Json }
      trigger_historical_backfill_all: { Args: never; Returns: undefined }
      update_bomb_used: {
        Args: { p_display_name: string; p_guild: string; p_player_id: string }
        Returns: undefined
      }
      update_boss_playbook: {
        Args: { p_boss_id: string; p_content: string }
        Returns: Json
      }
      update_cluster_identity: {
        Args: { p_cluster_id: string; p_updates: Json }
        Returns: undefined
      }
      update_guild_rankings_batch: {
        Args: { p_rankings: Json }
        Returns: number
      }
      update_player_api_key: {
        Args: { p_api_key: string; p_player_id: string }
        Returns: Json
      }
      update_player_api_key_admin: {
        Args: { p_encrypted_api_key: string; p_player_id: string }
        Returns: Json
      }
      update_player_boss_assignments_admin: {
        Args: {
          p_assignment_notes?: string
          p_player_id: string
          p_primary_boss?: string
          p_secondary_boss?: string
        }
        Returns: Json
      }
      update_player_boss_preferences_admin: {
        Args: { p_boss_preferences: Json; p_player_id: string }
        Returns: Json
      }
      update_player_discord_admin: {
        Args: { p_discord_username: string; p_player_id: string }
        Returns: Json
      }
      update_player_guild_membership: {
        Args: {
          p_display_name?: string
          p_new_guild_code: string
          p_player_id: string
          p_role?: string
        }
        Returns: Json
      }
      update_player_meta_teams_admin: {
        Args: {
          p_player_id: string
          p_primary_team?: string
          p_secondary_team?: string
          p_tertiary_team?: string
        }
        Returns: Json
      }
      update_player_notes_admin: {
        Args: {
          p_officer_notes?: string
          p_player_id: string
          p_player_notes?: string
        }
        Returns: Json
      }
      update_registration_progress: {
        Args: {
          guild_code_param: string
          mark_completed?: boolean
          new_status: string
        }
        Returns: boolean
      }
      update_sync_health: {
        Args: { p_guild_code: string; p_success: boolean }
        Returns: undefined
      }
      update_token_burn_state_for_guild: {
        Args: { p_guild_code: string; p_season?: string }
        Returns: undefined
      }
      update_user_profile: {
        Args: { new_username: string; user_id: string }
        Returns: undefined
      }
      upsert_herald_boss_config:
        | {
            Args: {
              p_boss_id: string
              p_custom_message_url: string
              p_discord_role_ids: string[]
              p_discord_role_labels: Json
              p_enabled: boolean
              p_extra_links: Json
              p_extra_videos: Json
              p_guild_code: string
              p_notes: string
              p_ping_mode: string
              p_pinned_replay_ids: string[]
              p_rarity_set: string
              p_replay_auto_count: number
              p_replay_link_mode: string
              p_side1_behaviour: string
              p_side1_notes: string
              p_side1_threshold_hp_pct: number
              p_side2_behaviour: string
              p_side2_notes: string
              p_side2_threshold_hp_pct: number
              p_updated_by: string
              p_webhook_config_ids: string[]
            }
            Returns: {
              boss_id: string
              created_at: string
              custom_message_url: string | null
              discord_role_ids: string[]
              discord_role_labels: Json
              enabled: boolean
              extra_links: Json
              extra_videos: Json
              guild_code: string
              id: number
              notes: string | null
              ping_mode: string
              ping_mode_explicit: boolean
              rarity_set: string | null
              side1_behaviour: string
              side1_notes: string | null
              side1_threshold_hp_pct: number | null
              side2_behaviour: string
              side2_notes: string | null
              side2_threshold_hp_pct: number | null
              updated_at: string
              updated_by: string | null
              webhook_config_ids: string[]
            }
            SetofOptions: {
              from: "*"
              to: "herald_boss_config"
              isOneToOne: true
              isSetofReturn: false
            }
          }
        | {
            Args: {
              p_boss_id: string
              p_custom_message_url: string
              p_discord_role_ids: string[]
              p_enabled: boolean
              p_extra_links: Json
              p_extra_videos: Json
              p_guild_code: string
              p_notes: string
              p_ping_mode: string
              p_pinned_replay_ids: string[]
              p_rarity_set: string
              p_replay_auto_count: number
              p_replay_link_mode: string
              p_side1_behaviour: string
              p_side1_notes: string
              p_side1_threshold_hp_pct: number
              p_side2_behaviour: string
              p_side2_notes: string
              p_side2_threshold_hp_pct: number
              p_updated_by: string
              p_webhook_config_ids: string[]
            }
            Returns: {
              boss_id: string
              created_at: string
              custom_message_url: string | null
              discord_role_ids: string[]
              discord_role_labels: Json
              enabled: boolean
              extra_links: Json
              extra_videos: Json
              guild_code: string
              id: number
              notes: string | null
              ping_mode: string
              ping_mode_explicit: boolean
              rarity_set: string | null
              side1_behaviour: string
              side1_notes: string | null
              side1_threshold_hp_pct: number | null
              side2_behaviour: string
              side2_notes: string | null
              side2_threshold_hp_pct: number | null
              updated_at: string
              updated_by: string | null
              webhook_config_ids: string[]
            }
            SetofOptions: {
              from: "*"
              to: "herald_boss_config"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      upsert_herald_role_mapping: {
        Args: {
          // Function args are pg-nullable; gen-types cannot infer that.
          p_active_boss_ids: string[] | null
          p_auto_update: boolean
          p_custom_message_only: boolean
          p_discord_role_id: string | null
          p_display_label: string | null
          p_enabled: boolean
          p_guild_code: string
          p_meta_team_slug: string
          p_prime_scope: string
          p_rarity_set: string | null
          p_track_only: boolean
          p_updated_by: string
        }
        Returns: {
          active_boss_ids: string[] | null
          auto_update: boolean
          created_at: string
          custom_message_only: boolean
          discord_role_id: string | null
          display_label: string | null
          enabled: boolean
          guild_code: string
          id: number
          last_auto_updated_at: string | null
          meta_team_slug: string
          prime_scope: string
          rarity_set: string | null
          track_only: boolean
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "herald_meta_role_mapping"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      upsert_subscription_from_stripe: {
        Args: {
          p_cancel_at_period_end?: boolean
          p_canceled_at?: string
          p_current_period_end: string
          p_current_period_start: string
          p_guild_code: string
          p_status: string
          p_stripe_customer_id: string
          p_stripe_subscription_id: string
        }
        Returns: Json
      }
      user_guild_restricts_playbooks: {
        Args: { p_user_id?: string }
        Returns: boolean
      }
      validate_and_use_invite_code: {
        Args: { p_code: string; p_user_id: string }
        Returns: Json
      }
      validate_guild_in_cluster: {
        Args: { p_cluster_code: string; p_guild_code: string }
        Returns: boolean
      }
      validate_guild_not_exists: {
        Args: { p_guild_code: string }
        Returns: boolean
      }
      validate_player_consistency: {
        Args: never
        Returns: {
          affected_count: number
          check_name: string
          details: string
          status: string
        }[]
      }
      validate_player_id_architecture: {
        Args: never
        Returns: {
          count_after: number
          count_before: number
          improvement_pct: number
          message: string
          status: string
          validation_step: string
        }[]
      }
      verify_discord_user_access: {
        Args: {
          p_discord_guild_id: string
          p_discord_user_id: string
          p_requested_guild?: string
        }
        Returns: {
          allowed: boolean
          cluster_access: boolean
          reason: string
          user_guild: string
          user_role: string
        }[]
      }
      verify_password: {
        Args: { hash: string; password: string }
        Returns: boolean
      }
      verify_player_api_key: {
        Args: { p_is_valid: boolean; p_player_data?: Json; p_player_id: string }
        Returns: undefined
      }
    }
    Enums: {
      aal_level: "aal1" | "aal2" | "aal3"
      app_role:
        | "leader"
        | "officer"
        | "member"
        | "Leader"
        | "Member"
        | "Officer"
        | "demo"
      claim_error_code:
        | "PLAYER_NOT_FOUND"
        | "PLAYER_ALREADY_CLAIMED"
        | "PLAYER_INACTIVE"
        | "MULTIPLE_RECORDS"
        | "INVALID_INPUT"
        | "DATABASE_ERROR"
      code_challenge_method: "s256" | "plain"
      factor_status: "unverified" | "verified"
      factor_type: "totp" | "webauthn"
      one_time_token_type:
        | "confirmation_token"
        | "reauthentication_token"
        | "recovery_token"
        | "email_change_token_new"
        | "email_change_token_current"
        | "phone_change_token"
      raid_rarity:
        | "common"
        | "uncommon"
        | "rare"
        | "epic"
        | "legendary"
        | "mythic"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      aal_level: ["aal1", "aal2", "aal3"],
      app_role: [
        "leader",
        "officer",
        "member",
        "Leader",
        "Member",
        "Officer",
        "demo",
      ],
      claim_error_code: [
        "PLAYER_NOT_FOUND",
        "PLAYER_ALREADY_CLAIMED",
        "PLAYER_INACTIVE",
        "MULTIPLE_RECORDS",
        "INVALID_INPUT",
        "DATABASE_ERROR",
      ],
      code_challenge_method: ["s256", "plain"],
      factor_status: ["unverified", "verified"],
      factor_type: ["totp", "webauthn"],
      one_time_token_type: [
        "confirmation_token",
        "reauthentication_token",
        "recovery_token",
        "email_change_token_new",
        "email_change_token_current",
        "phone_change_token",
      ],
      raid_rarity: [
        "common",
        "uncommon",
        "rare",
        "epic",
        "legendary",
        "mythic",
      ],
    },
  },
} as const
