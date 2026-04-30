# generated from colcon_powershell/shell/template/prefix_chain.ps1.em

# This script extends the environment with the environment of other prefix
# paths which were sourced when this file was generated as well as all packages
# contained in this prefix path.

# function to source another script with conditional trace output
# first argument: the path of the script
function _colcon_prefix_chain_powershell_source_script {
  param (
    $_colcon_prefix_chain_powershell_source_script_param
  )
  # source script with conditional trace output
  if (Test-Path $_colcon_prefix_chain_powershell_source_script_param) {
    if ($env:COLCON_TRACE) {
      echo ". '$_colcon_prefix_chain_powershell_source_script_param'"
    }
    . "$_colcon_prefix_chain_powershell_source_script_param"
  } else {
    Write-Error "not found: '$_colcon_prefix_chain_powershell_source_script_param'"
  }
}

# source chained prefixes
_colcon_prefix_chain_powershell_source_script "/opt/ros/humble\local_setup.ps1"
_colcon_prefix_chain_powershell_source_script "/home/bp/koras_ck_ws/install\local_setup.ps1"
_colcon_prefix_chain_powershell_source_script "/home/bp/Desktop/mj_ws/install\local_setup.ps1"
_colcon_prefix_chain_powershell_source_script "/home/bp/doosan_ros2_ws/install\local_setup.ps1"
_colcon_prefix_chain_powershell_source_script "/home/bp/realsense_cv_ws/install\local_setup.ps1"
_colcon_prefix_chain_powershell_source_script "/home/bp/bp_gui_ws_sim/install\local_setup.ps1"
_colcon_prefix_chain_powershell_source_script "/home/bp/sam_ws/install\local_setup.ps1"
_colcon_prefix_chain_powershell_source_script "/home/bp/zivid_ws/install\local_setup.ps1"
_colcon_prefix_chain_powershell_source_script "/home/bp/robot_control_ws/install\local_setup.ps1"
_colcon_prefix_chain_powershell_source_script "/home/bp/bin_picking_ws/install\local_setup.ps1"
_colcon_prefix_chain_powershell_source_script "/home/bp/llm_ws/install\local_setup.ps1"
_colcon_prefix_chain_powershell_source_script "/home/bp/cal_ws/install\local_setup.ps1"
_colcon_prefix_chain_powershell_source_script "/home/bp/usb_cam_ws/install\local_setup.ps1"

# source this prefix
$env:COLCON_CURRENT_PREFIX=(Split-Path $PSCommandPath -Parent)
_colcon_prefix_chain_powershell_source_script "$env:COLCON_CURRENT_PREFIX\local_setup.ps1"
