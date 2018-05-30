using System;
using Neuralyzer.Components;
using Neuralyzer.Core;
using UnityEngine;
using UnityEngine.UI;

namespace Demo
{
  public class JoinRoom : MonoBehaviour
  {
    public InputField iField;

    public void JoinCreateRoom()
    {
      NeuraManager.Instance.JoinRoom(iField.text??"SidsTest",NeuraCore.Instance.config.Username);
    }
  }
}
