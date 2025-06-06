type NavigationItemClicked = {
  item: string;
};

type NavigationEventParameters = {
  'navigation.help_menu_opt_in_chonk_ui_clicked': Record<string, unknown>;
  'navigation.help_menu_opt_in_stacked_navigation_clicked': Record<string, unknown>;
  'navigation.help_menu_opt_out_chonk_ui_clicked': Record<string, unknown>;
  'navigation.help_menu_opt_out_stacked_navigation_clicked': Record<string, unknown>;
  'navigation.primary_item_clicked': NavigationItemClicked;
  'navigation.secondary_item_clicked': NavigationItemClicked;
};

type NavigationEventKey = keyof NavigationEventParameters;

export const navigationAnalyticsEventMap: Record<NavigationEventKey, string | null> = {
  'navigation.help_menu_opt_in_stacked_navigation_clicked':
    'Navigation: Help Menu Opt In To Stacked Navigation Clicked',
  'navigation.help_menu_opt_out_stacked_navigation_clicked':
    'Navigation: Help Menu Opt Out Of Stacked Navigation Clicked',
  'navigation.primary_item_clicked': 'Navigation: Primary Item Clicked',
  'navigation.secondary_item_clicked': 'Navigation: Secondary Item Clicked',
  'navigation.help_menu_opt_out_chonk_ui_clicked':
    'Navigation: Help Menu Opt Out Chonk UI Clicked',
  'navigation.help_menu_opt_in_chonk_ui_clicked':
    'Navigation: Help Menu Opt In Chonk UI Clicked',
};
